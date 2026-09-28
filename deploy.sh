#!/usr/bin/env bash
# 部署脚本：把 dist 构建产物发布到 gh-pages 分支。
# 原则：orphan 分支上绝不 git add -A（该分支没有 .gitignore，会把 node_modules 全部带入），
#       只显式添加构建产物文件。
set -euo pipefail
cd "$(dirname "$0")"

# 前置检查：构建产物存在、工作区干净、main 分支
if [ ! -f dist/index.html ]; then
  echo "错误：dist 构建产物不存在，先执行 npm run build" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "错误：工作区有未提交修改，先提交再部署" >&2
  exit 1
fi
if [ "$(git branch --show-current)" != "main" ]; then
  echo "错误：请在 main 分支执行部署" >&2
  exit 1
fi

git switch --orphan gh-pages-deploy-tmp
cp dist/* .
# 只添加构建产物（index.html 与 service worker 脚本）
git add index.html sw.js
git -c user.name="labman-1" -c user.email="labman-1@users.noreply.github.com" \
  commit -m "deploy: $(date +%Y%m%d-%H%M)"
git ls-tree --name-only HEAD  # 打印部署内容供人工核对（应只有两个文件）
git push origin gh-pages-deploy-tmp:gh-pages --force
git switch main
git branch -D gh-pages-deploy-tmp
echo "=== 部署完成 ==="
