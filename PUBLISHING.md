# 发布到 GitHub 与 DSH 插件市场

## 1. GitHub 仓库

仓库：`https://github.com/flowers-59f/dsh-petpal`

```bash
gh auth login -h github.com
gh repo create flowers-59f/dsh-petpal --public --source=. --remote=origin --push
gh repo edit flowers-59f/dsh-petpal --add-topic dsh-plugin
```

如果仓库已经存在，只用：

```bash
git remote add origin https://github.com/flowers-59f/dsh-petpal.git
git push -u origin main
```

## 2. 安装方式

```bash
dsh plugin --profile <profile> add github:flowers-59f/dsh-petpal
```

插件市场收录后，也可以在 **插件 → 发现** 里安装。

## 3. 收录到插件市场

dsh-market 的列表来自策展仓库 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
收录要求：

- 仓库公开，且创建**满 1 天**
- `package.json` 声明 `dsh.bundle` 与 `repository`
- 仓库添加 `dsh-plugin` topic
- 在 `data/plugins/` 放一个条目文件，发 PR

条目已经准备好：`market/flowers-59f__dsh-petpal.yml`。
提交时复制为：

```text
data/plugins/flowers-59f__dsh-petpal.yml
```

PR 标题示例：

```text
Add dsh-petpal: macOS desktop pets for DSH
```

市场会从仓库根目录的 `screenshots.json` 读取截图（当前指向 `docs/bubble.png`）。

## 4. 许可证

MIT，见仓库根目录的 `LICENSE`。

## 5. 备注

- 桌面组件是 macOS 原生应用，Windows/Linux 上设置页会提示不可用。
- 仓库已忽略 `.build-cache/`、`desktop/.build-cache/`，不会把 400MB 编译缓存提交上去。
