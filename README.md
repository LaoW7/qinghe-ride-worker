# 青荷礼包乘车码快捷入口

使用 Cloudflare Workers 为杭州市民卡 App 的青荷礼包免费乘车码创建个人入口，配合 iPhone 快捷指令减少打开二维码的操作步骤。

Worker 使用个人访问码保护入口，将人才系统 Token 和券参数组合成官方页面地址。二维码由官方页面生成和刷新。

## 功能

- 一个 JavaScript 文件即可部署，无需 KV、D1 或 R2。
- 人才系统 Token 存放在 Cloudflare Secret，代码不包含真实凭据。
- 个人访问码保护入口；Safari 可以记住访问码并自动跳转。
- 保留官方页面的二维码编码与刷新逻辑。
- 提供 iPhone 快捷指令配置和完整抓包、排障教程。
- 可选市民卡登录 Token 转换模式。

## 快速部署

安装 Node.js LTS，在仓库目录执行：

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

记下部署输出的实际 HTTPS 地址。在该 Worker 的 Settings → Variables and Secrets 配置以下四项并部署：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `ACCESS_KEY` | Secret | 至少 32 位随机字符的个人访问码 |
| `HZRCK_TOKEN` | Secret | `getOffLineCode` 请求体中的 `accessToken` |
| `COUPON_ID` | 文本变量或 Secret | 同一请求体中的 `couponId`，按字符串填写 |
| `USER_COUPON_ID` | 文本变量或 Secret | 同一请求体中的 `userCouponId`，按字符串填写 |

**变量名区分大小写。** `HZRCK_TOKEN` 对应人才系统登录态。接口响应里的十六进制长串是二维码数据，不能作为这个 Token 使用。所有长 ID 按字符串处理，避免 JavaScript Number 的精度损失。

也可以用 Wrangler 依次配置，交互提示中粘贴各自的值：

```powershell
npx wrangler secret put ACCESS_KEY
npx wrangler secret put HZRCK_TOKEN
npx wrangler secret put COUPON_ID
npx wrangler secret put USER_COUPON_ID
```

如果已有 Worker，可在控制台用 `worker.mjs` 的全部内容替换入口代码，再配置上述变量。

## 使用

1. 用 iPhone Safari 打开 Worker 地址。
2. 输入个人访问码，勾选记住访问码，点击打开乘车码。
3. 检查官方页面的二维码是否能够显示、刷新。
4. 新建快捷指令，按顺序添加“URL”和“打开 URL”，URL 填 Worker 地址。
5. 测试成功后添加到主屏幕。

记住访问码依赖该浏览器对此域名的本地存储。更换域名、浏览器、无痕模式或清除网站数据后，可能需要重新输入。Token 过期后，更新 `HZRCK_TOKEN`。重新领取券后，检查两个券 ID 是否变化。

## 完整教程

[从抓包到 iPhone 快捷指令](docs/guide.md) 包含：

- 热点 IP 与代理设置。
- Windows 防火墙定向放行。
- HTTPS 解密和请求筛选。
- 三类 Token 的区别。
- 官方页面的参数、二维码编码及刷新逻辑。
- Workers 部署和两种快捷指令配置。
- 常见错误排查。

## 文件与验证

| 文件 | 用途 |
| --- | --- |
| `worker.mjs` | Worker 与移动端入口页面 |
| `wrangler.jsonc` | 部署配置 |
| `test.mjs` | 本地测试，全部使用示例数据 |
| `docs/guide.md` | 完整操作教程 |

```powershell
node --test test.mjs
```

8 项本地测试覆盖鉴权、直接模式、可选转换模式、券 ID 处理、错误脱敏和路由限制。直接模式已在一次真实 iPhone Safari 操作中确认能够打开官方页面。Token 长期有效性及实际闸机接受情况需要各自验证。

## 参考

本实现独立编写，Token 转换流程参考 [CH3NGYZ/hzsmkByBus](https://github.com/CH3NGYZ/hzsmkByBus)，页面参数及二维码编码方式核对了当前业务站点的前端脚本。

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [mitmproxy 文档](https://docs.mitmproxy.org/stable/)
- [Apple 快捷指令 URL 动作](https://support.apple.com/en-mo/guide/shortcuts/apd68802640c/ios)

该入口依赖现有有效登录态和官方页面；不会自动登录、延长 Token 有效期或保存二维码截图。
