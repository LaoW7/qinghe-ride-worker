# 从杭州市民卡抓包到 iPhone 青荷乘车码快捷入口

青荷礼包的公交、地铁免费乘车码可以在杭州市民卡 App 中打开。希望减少逐级点击时，可以先查清网页入口和登录参数，再使用自己的 Cloudflare Worker 生成入口地址，最后交给 iPhone 快捷指令打开。

本文按一次实际操作整理，使用 Windows 笔记本热点、iPhone、mitmproxy 和 Cloudflare Workers。文中 IP 是网络配置示例，券 ID 和 Token 都使用示例或占位符。

## 1. 为什么普通 Wireshark 抓包没有找到完整 URL

iPhone 连接笔记本热点后，笔记本能观察它的网络流量。HTTPS 中的请求路径、请求体和响应体受 TLS 保护，普通 pcapng 通常只能提供连接等线索。

本次起初的短时抓包能看到 TLS 数据和代理连接，没有读到完整业务请求。为了检查自己的 App 请求，改用 HTTPS 解密代理。业务 App 如果使用证书固定校验，可能无法通过这个方法解密。

## 2. 配置热点与 mitmproxy

Windows 安装 [mitmproxy](https://docs.mitmproxy.org/stable/overview-installation/)，启动：

```powershell
mitmweb --listen-host 0.0.0.0 --listen-port 8080
```

保持终端运行。电脑的 mitmweb 管理界面通常监听本机 8081，手机应连接代理端口 8080。

用 `ipconfig` 确认笔记本热点网卡地址。例如：

| 地址 | 角色 |
| --- | --- |
| `192.168.137.1` | 笔记本在热点网段中的地址 |
| `192.168.31.201` | 笔记本从上游路由器取得的地址 |

iPhone 连接笔记本热点，在该 Wi-Fi 详情页设置手动代理：服务器填热点网卡地址，端口填 8080，关闭认证。上述示例使用 `192.168.137.1`。

在 Safari 打开 `http://mitm.it`。这个页面由代理提供，安装证书之前就应该能打开。

### 手机超时，电脑 curl 正常

在笔记本测试：

```powershell
curl.exe -v --proxy http://127.0.0.1:8080 http://mitm.it
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
```

如果监听地址为 `127.0.0.1`，重新用上面的 `--listen-host 0.0.0.0` 命令启动。

本次操作中，手机能够 ping 通热点网关，电脑 curl 能返回 HTML，但手机 Safari 超时，mitmweb 没有连接记录。为 Windows 防火墙添加以下规则后恢复。管理员 PowerShell 执行：

```powershell
New-NetFirewallRule -Name "Mitmproxy-Hotspot-8080" -DisplayName "mitmproxy hotspot TCP 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -LocalAddress 192.168.137.1 -RemoteAddress 192.168.137.0/24 -Profile Any
```

按实际热点地址调整本地地址和远端网段。规则只匹配这个地址和端口的入站连接。Ping 成功不能证明 TCP 8080 已经可达。

完成抓包后，如需移除这条规则：

```powershell
Remove-NetFirewallRule -Name "Mitmproxy-Hotspot-8080"
```

## 3. 安装并信任抓包证书

1. Safari 在 `http://mitm.it` 下载 iOS 证书。
2. 设置 → 通用 → VPN 与设备管理，安装对应描述文件。
3. 设置 → 通用 → 关于本机 → 证书信任设置，开启该证书的完全信任。
4. Safari 访问一个 HTTPS 页面，确认 mitmweb 能读到完整请求和响应。
5. 重新进入市民卡 App 的杭州人才码、青荷礼包和乘车码页面。

操作结束后，关闭 Wi-Fi 手动代理，移除安装的抓包证书。

## 4. 找到实际业务请求

市民卡登录 Token 的参考线索是 `open.iconntech.com` 下的 `queryUserByToken` 和 `loginFaceCheck`。已有登录态时，这些请求未必再次出现。

本次只筛选这个域名时，看到的是 `indexNew.js` 静态文件。随后在 mitmweb 使用：

```text
~u "getHzrckToken|changeToken|queryUserByToken|loginFaceCheck"
```

以及请求和响应正文筛选：

```text
~b "accessToken|channelToken|hzrckToken"
```

匹配到脚本时，需要区分字段名称和真实业务值。左侧选择具体请求后，再看右侧 Request 和 Response，避免读取先前选中的图片请求。

最后确认，打开二维码及点击刷新都会请求：

```text
POST https://talent.hzrcm.cn/smk_hztalent_stu/front/app/traffic/getOffLineCode
```

捕获到的请求结构如下，ID 均为示例：

```json
{
  "accessToken": "YOUR_TALENT_TOKEN",
  "couponId": "9000000000000000001",
  "userCouponId": "9000000000000000002"
}
```

其中，实际请求还包含：

```text
Content-Type: application/json;charset=UTF-8
sendChl: hzsmk.h5
sendClient: hellohzsmk
Origin: https://talent.hzrcm.cn
Referer: https://talent.hzrcm.cn/exthtml/youngTalentCard/freeCoderide/
```

业务成功响应结构：

```json
{
  "code": "PY0000",
  "msg": "成功",
  "response": "HEX_ENCODED_QR_PAYLOAD"
}
```

HTTP 200 和业务成功码分别检查。`response` 是二维码载荷，Token 来自 Request 中的 `accessToken`。

## 5. 区分 Token 类型

| 阶段 | 含义 | Worker 配置 |
| --- | --- | --- |
| 市民卡登录 accessToken | 市民卡账号的登录态，原项目将其用于渠道转换 | `SMK_TOKEN`，可选 |
| channelToken | 转换接口返回的中间凭据，供人才系统转换使用 | 无需手动配置 |
| 人才系统 Token | `getOffLineCode` 等人才系统请求使用的 accessToken | `HZRCK_TOKEN` |

市民卡登录 accessToken 如要使用可选转换模式，填写 `SMK_TOKEN`。两个系统的字段都可能叫 `accessToken`，需要结合请求域名和业务判断。

原项目的转换链路为市民卡登录 Token → `changeToken` → channelToken → `getHzrckToken` → 人才系统 Token。

本次从 `getOffLineCode` 已经取得人才系统 Token，因此直接使用它即可。误将它填入 `SMK_TOKEN` 会走到不适合它的转换流程。

## 6. 核对官方页面参数与二维码编码

读取当时实际加载的前端脚本，确认初始化读取：

| 页面参数 | 对应接口字段 |
| --- | --- |
| `accessToken`，也接受 `token` | `accessToken` |
| `qid` | `couponId` |
| `userCouponId` | `userCouponId` |

因此入口需要带完整参数：

```text
https://talent.hzrcm.cn/exthtml/youngTalentCard/freeCoderide/#/byBus?accessToken=YOUR_TALENT_TOKEN&qid=YOUR_COUPON_ID&userCouponId=YOUR_USER_COUPON_ID
```

Worker 使用 `URLSearchParams` 编码参数，并让官方页面负责二维码生成。官方代码将响应的十六进制字符串还原为字节，经过 ISO8859-1 处理交给 ZXing 生成二维码。直接把长串按普通文本编码，载荷会不同。

官方页面当时使用约 50 秒的定时器刷新。这个行为不能证明二维码或登录 Token 的精确有效期，后台页面的浏览器定时器也可能被节流。

核对的脚本地址：
https://talent.hzrcm.cn/exthtml/youngTalentCard/freeCoderide/static/js/0.25b07d8d22aa8438aad3.js

业务站点未来更新后，脚本文件名和接口可能变化。本项目使用官方页面继续负责生成二维码。

## 7. 配置 Worker

部署命令和控制台配置见 [README](../README.md)。配置项必须大小写一致：

| 名称 | 用途 |
| --- | --- |
| `ACCESS_KEY` | 保护个人入口，至少 32 位随机字符 |
| `HZRCK_TOKEN` | 实际人才系统 Token |
| `COUPON_ID` | 实际 couponId 字符串 |
| `USER_COUPON_ID` | 实际 userCouponId 字符串 |

可以在 PowerShell 生成随机访问码，保存在自己的密码管理器：

```powershell
$qingheBytes = New-Object byte[] 32
$qingheRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$qingheRng.GetBytes($qingheBytes)
$qingheRng.Dispose()
$qingheKey = -join ($qingheBytes | ForEach-Object { $_.ToString('x2') })
$qingheKey
```

令牌留在 Cloudflare Secret 中，代码和公开示例不填写真实值。持有个人访问码的人可以调用该入口，应只在自己的设备保存。

### 报错仍然是“市民卡 Token 转换连接失败”

新版只要读取到非空的 `HZRCK_TOKEN`，就会直接返回跳转地址，跳过 Token 转换接口。

检查线上代码中是否有 `env.HZRCK_TOKEN`、同一个 Worker 的 Secret 名称是否完全一致、配置是否已经部署，以及访问的是否是该 Worker 的正式地址。本次修正变量名称后，iPhone 成功打开官方页面。

这个报错表示 Worker 请求转换接口时失败，不能单凭它判断 Token 是否失效。

## 8. 配置 iPhone 快捷指令

### 简单版

1. Safari 打开 Worker 地址，输入个人访问码并勾选记住。
2. 新建快捷指令“青荷地铁码”。
3. 添加“URL”，填写实际 Worker HTTPS 地址。
4. 添加“打开 URL”，打开上一步的地址。
5. 运行测试，成功后添加到主屏幕。

使用同一浏览器与域名的本地存储时，入口可以自动使用已保存的访问码。清除网站数据或更换浏览环境后，需要重新输入。

### 进阶版

直接请求 Worker，再让 Safari 打开返回的官方地址：

1. “URL”：`https://YOUR_WORKER_HOST/api/ride`。
2. “获取 URL 内容”：方法 POST，请求头 `Authorization` 为 `Bearer YOUR_ACCESS_KEY`，Bearer 后有一个空格。
3. “获取词典值”：从返回结果取得键 `url`。
4. “如果”：该值有内容时，使用“打开 URL”。
5. “否则”：取得返回结果的 `error`，用“显示提醒”显示。

快捷指令包含个人访问码时，不应作为公开示例上传。公开教程只使用占位符。

## 9. 验证与维护

- 在 Safari 检查二维码显示，并测试手动刷新。
- 在实际进站前确认官方页面和权益状态正常。
- Token 失效后更新 `HZRCK_TOKEN`；它不会通过这个入口自动续期。
- 领取新券后检查两个券 ID。
- 个人访问码泄露时更新 `ACCESS_KEY`。
- 源码、本地测试和文档中均不包含真实 Token、二维码载荷或个人券 ID。

本地测试使用示例数据，8 项测试覆盖鉴权、路由、券 ID 精度、转换流程和错误脱敏。一次实际操作确认了直接模式能在 iPhone Safari 打开官方页面；实际闸机接受情况及长期可靠性需要进一步验证。

## 参考资料

- [原项目 CH3NGYZ/hzsmkByBus](https://github.com/CH3NGYZ/hzsmkByBus)
- [mitmproxy 代理模式](https://docs.mitmproxy.org/stable/concepts/modes/)
- [mitmproxy 证书](https://docs.mitmproxy.org/stable/concepts/certificates/)
- [mitmproxy 过滤表达式](https://docs.mitmproxy.org/stable/concepts/filters/)
- [Windows 防火墙规则](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)
- [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Apple 快捷指令 URL 动作](https://support.apple.com/en-mo/guide/shortcuts/apd68802640c/ios)
