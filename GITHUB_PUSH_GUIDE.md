# 📤 推送到 GitHub 指南

已初始化 git 仓库并创建了初始提交。按以下步骤推送到 GitHub：

## 方案 1：使用 HTTPS（推荐）

### 步骤 1：在 GitHub 上创建仓库
1. 登录 GitHub：https://github.com
2. 点击右上角的 **+** 按钮 → **New repository**
3. 填写以下信息：
   - **Repository name**: `weconnect`
   - **Description**: WeChat intelligent assistant with AI-powered message classification and auto-reply
   - **Visibility**: Public（或 Private）
   - **Initialize with**: 勾除所有选项（我们已有代码）
4. 点击 **Create repository**

### 步骤 2：复制仓库地址
创建后会看到类似的指令。复制 HTTPS 地址：
```
https://github.com/YOUR_USERNAME/weconnect.git
```

### 步骤 3：推送代码
在项目目录运行：
```bash
cd weconnect
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/weconnect.git
git push -u origin main
```

系统会提示输入 GitHub 用户名和密码。

**注意**：如果使用 2FA，需要用 Personal Access Token 代替密码：
1. 访问 https://github.com/settings/tokens
2. 生成新 token，勾选 `repo` 权限
3. 用 token 代替密码

---

## 方案 2：使用 SSH（高级）

### 前提条件
已配置 SSH 密钥对。如未配置，参考：https://docs.github.com/en/authentication/connecting-to-github-with-ssh

### 步骤
```bash
cd weconnect
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/weconnect.git
git push -u origin main
```

---

## 方案 3：如果已有仓库，更新 remote

如果已在 GitHub 创建了仓库，只需更新远程地址：

```bash
cd weconnect
git remote add origin https://github.com/YOUR_USERNAME/weconnect.git
# 或
git remote add origin git@github.com:YOUR_USERNAME/weconnect.git

git branch -M main
git push -u origin main
```

---

## 验证推送成功

推送完成后，访问：
```
https://github.com/YOUR_USERNAME/weconnect
```

应该看到：
- ✅ 28 个文件已上传
- ✅ README.md、STARTUP_GUIDE.md、IMPROVEMENTS_SUMMARY.md 等文档可见
- ✅ 完整的 git 历史记录

---

## 快速参考

| 步骤 | 命令 |
|------|------|
| 1. 初始化 (已完成) | `git init` |
| 2. 配置用户 (已完成) | `git config user.name "..."` |
| 3. 添加所有文件 (已完成) | `git add -A` |
| 4. 提交 (已完成) | `git commit -m "..."` |
| 5. 添加远程仓库 | `git remote add origin <URL>` |
| 6. 重命名分支为 main | `git branch -M main` |
| 7. 推送代码 | `git push -u origin main` |

---

## 后续更新

提交后续变更：
```bash
git add .
git commit -m "描述你的改动"
git push origin main
```

---

## 常见问题

### Q: 提示 "fatal: A git directory already exists here"
**A**: 项目已有 git 仓库。跳过 `git init`，直接配置 remote 和推送。

### Q: "Permission denied (publickey)"（SSH）
**A**: SSH 密钥未正确配置。使用 HTTPS 方案或重新配置 SSH。

### Q: "Authentication failed"（HTTPS）
**A**: 密码错误或需要用 Personal Access Token。

### Q: 推送后代码未显示
**A**: 等待几秒钟，刷新 GitHub 页面，或检查是否推送到正确的分支（main）。

---

## 项目结构

推送后，GitHub 上的项目结构：
```
weconnect/
├── README.md                      # 项目说明
├── STARTUP_GUIDE.md               # 启动指南
├── IMPROVEMENTS_SUMMARY.md        # 改进总结
├── GITHUB_PUSH_GUIDE.md          # 本文档
├── package.json                   # NPM 配置
├── server.js                      # 服务器入口
├── server/
│   ├── db.js                      # JSON 数据库
│   ├── services/
│   │   ├── ai.js                  # AI 服务（分类 + 策略）
│   │   ├── monitor.js             # 消息监控
│   │   ├── lifecycle.js           # 启动任务
│   │   └── browser.js             # 浏览器自动化
│   └── routes/
│       ├── wechat.js              # 微信 API
│       ├── settings.js            # 设置 API
│       ├── messages.js            # 消息 API
│       ├── todos.js               # 待办 API
│       └── models.js              # 模型 API
├── src/
│   ├── App.jsx                    # 主应用
│   ├── pages/                     # 页面组件
│   └── components/                # UI 组件
└── data/                          # JSON 数据库存储目录
```

---

祝推送顺利！如有问题，参考官方文档：
- https://docs.github.com/en/get-started/importing-your-projects-to-github
- https://docs.github.com/en/get-started/using-git
