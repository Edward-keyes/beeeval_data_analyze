# NAS File API Server

绿联 NAS 文件服务 API，提供目录浏览、文件下载、视频流播放等功能。  
纯 Python 标准库实现，零依赖。

---

## 快速开始

### 启动服务

```bash
cd /home/boringmedia/nas-api
python3 server.py
```

服务默认运行在 `0.0.0.0:8900`。

### 常用启动参数

```bash
python3 server.py --port 9000        # 指定端口
python3 server.py --show-token       # 查看当前 Token
python3 server.py --reset-token      # 重新生成 Token
```

---

## 认证方式

所有接口均需携带 Token，支持两种方式（二选一）：

| 方式 | 示例 |
|------|------|
| 查询参数 | `?token=YOUR_TOKEN` |
| 请求头 | `Authorization: Bearer YOUR_TOKEN` |

当前 Token 保存在 `config.json` 中，可通过 `--show-token` 查看，`--reset-token` 重置。

---

## API 接口文档

### 1. 浏览目录 — `GET /api/browse`

列出指定目录下的文件和文件夹。不传 `path` 时返回所有允许访问的根目录列表。

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 否 | 目录路径，如 `/volume1` |
| `sort` | 否 | 排序字段：`name`（默认）、`size`、`modified` |
| `order` | 否 | 排序方向：`asc`（默认）、`desc` |
| `type` | 否 | 过滤类型：`video`、`dir`、`file` |
| `offset` | 否 | 分页偏移量，默认 `0` |

**示例请求：**

```bash
# 列出根目录
curl "http://NAS_IP:8900/api/browse?token=TOKEN"

# 浏览 /volume1，只看视频文件，按修改时间倒序
curl "http://NAS_IP:8900/api/browse?path=/volume1&type=video&sort=modified&order=desc&token=TOKEN"
```

**返回示例：**

```json
{
  "current_path": "/volume1",
  "parent_path": "/",
  "total": 5,
  "offset": 0,
  "items": [
    {
      "name": "movies",
      "path": "/volume1/movies",
      "is_dir": true,
      "size": null,
      "modified": 1773674734.59,
      "mime": null,
      "is_video": false
    },
    {
      "name": "demo.mp4",
      "path": "/volume1/demo.mp4",
      "is_dir": false,
      "size": 104857600,
      "modified": 1773674800.00,
      "mime": "video/mp4",
      "is_video": true
    }
  ]
}
```

---

### 2. 下载文件 — `GET /api/download`

下载指定文件，响应头包含 `Content-Disposition`，浏览器会弹出保存对话框。

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 文件完整路径 |

**示例请求：**

```bash
curl -o file.zip "http://NAS_IP:8900/api/download?path=/volume1/data/file.zip&token=TOKEN"
```

---

### 3. 视频流播放 — `GET /api/stream`

流式传输视频文件，**完整支持 HTTP Range 请求**，可在浏览器中直接播放并拖动进度条。

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 视频文件完整路径 |

**使用方式：**

```bash
# 浏览器地址栏直接打开即可播放
http://NAS_IP:8900/api/stream?path=/volume1/movies/video.mp4&token=TOKEN
```

```html
<!-- 嵌入 HTML 页面 -->
<video controls>
  <source src="http://NAS_IP:8900/api/stream?path=/volume1/movies/video.mp4&token=TOKEN" />
</video>
```

支持的视频格式：`.mp4` `.mkv` `.avi` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.ts` `.rmvb` `.rm` `.3gp`

---

### 4. 文件信息 — `GET /api/info`

获取单个文件或目录的详细信息。

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 文件或目录路径 |

**返回示例：**

```json
{
  "name": "video.mp4",
  "path": "/volume1/movies/video.mp4",
  "is_dir": false,
  "size": 1073741824,
  "size_human": "1.0 GB",
  "modified": 1773674800.00,
  "mime": "video/mp4",
  "is_video": true
}
```

---

### 5. 搜索文件 — `GET /api/search`

按文件名关键词在指定目录下递归搜索。

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 搜索起始目录 |
| `keyword` | 是 | 文件名关键词（不区分大小写） |
| `depth` | 否 | 最大递归深度，默认 `3` |
| `limit` | 否 | 最大返回数量，默认 `100` |

**示例请求：**

```bash
curl "http://NAS_IP:8900/api/search?path=/volume1&keyword=.mp4&depth=5&limit=20&token=TOKEN"
```

---

## 配置文件

配置文件位于 `/home/boringmedia/nas-api/config.json`，修改后重启服务生效。

```json
{
  "host": "0.0.0.0",
  "port": 8900,
  "api_token": "YOUR_AUTO_GENERATED_TOKEN",
  "allowed_roots": [
    "/volume1",
    "/mnt/media_rw",
    "/mnt/@usb"
  ],
  "max_items_per_page": 500,
  "chunk_size": 1048576
}
```

| 字段 | 说明 |
|------|------|
| `host` | 监听地址，`0.0.0.0` 表示所有网卡 |
| `port` | 监听端口 |
| `api_token` | 访问令牌，首次启动自动生成 |
| `allowed_roots` | 允许访问的根目录白名单（防止路径遍历） |
| `max_items_per_page` | 目录浏览单页最大条目数 |
| `chunk_size` | 文件传输分块大小（字节） |

---

## 开机自启

### 安装 systemd 服务（需要 sudo）

```bash
sudo ln -sf /home/boringmedia/nas-api/nas-api.service /etc/systemd/system/nas-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now nas-api
```

### 管理命令

```bash
sudo systemctl status nas-api    # 查看状态
sudo systemctl restart nas-api   # 重启
sudo systemctl stop nas-api      # 停止
sudo systemctl disable nas-api   # 取消开机自启
```

---

## 内网穿透

完成内网穿透后（frp / Cloudflare Tunnel / ZeroTier / Tailscale 等），将 `NAS_IP:8900` 替换为你的公网地址或域名即可。

**建议搭配反向代理（Nginx / Caddy）加上 HTTPS：**

```nginx
# Nginx 示例
server {
    listen 443 ssl;
    server_name nas.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8900;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;          # 视频流不缓冲
        proxy_request_buffering off;
        client_max_body_size 0;       # 不限制大小
    }
}
```

---

## 文件结构

```
/home/boringmedia/nas-api/
├── server.py           # 主服务脚本
├── config.json         # 运行时配置（含 Token）
├── nas-api.service     # systemd 服务文件
└── README.md           # 本文档
```

---

## 安全说明

- 所有请求必须携带 Token，无 Token 返回 `401`
- 只能访问 `allowed_roots` 白名单中的目录，无法通过 `../` 等方式穿越
- Token 可随时通过 `--reset-token` 重置
- 建议内网穿透后务必启用 HTTPS
