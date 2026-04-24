# Moonshine ASR 迁移指南

本文档说明如何将 BeeEVAL 项目从 Whisper ASR 迁移到更快的 Moonshine ASR。

## 迁移概述

本次迁移将语音识别引擎从 OpenAI Whisper 替换为 Moonshine ASR，带来以下改进：

- **速度提升**: 10-100 倍更快的转录速度
- **准确率提高**: WER 从 7.44% 降至 6.65%
- **资源占用降低**: 模型参数量减少 85%
- **更好的中文支持**: 专用中文优化模型

## 安装步骤

### 1. 安装 Moonshine Voice

```bash
cd D:\data\project_IntelliJ\BeeEVAL\api
. venv/Scripts/activate  # Windows PowerShell 使用：.\venv\Scripts\Activate.ps1
pip install moonshine-voice
```

### 2. 下载 Moonshine 模型

使用提供的下载脚本下载中文模型：

```bash
# 激活虚拟环境后，在 api 目录下运行
. venv/Scripts/activate  # Windows PowerShell: .\venv\Scripts\Activate.ps1

# 下载 Small 模型（推荐）
python download_moonshine_model.py --language zh --size small

# 或者下载 Medium 模型（最高准确率）
python download_moonshine_model.py --language zh --size medium

# 或者下载 Tiny 模型（最快速度）
python download_moonshine_model.py --language zh --size tiny
```

### 3. 配置环境变量

下载完成后，脚本会输出模型路径。更新 `.env` 文件：

```env
# Windows 路径示例（使用正斜杠）
MOONSHINE_MODEL_PATH=C:/Users/YourName/AppData/Local/moonshine_voice/moonshine_voice/Cache/download.moonshine.ai/model/base-zh/quantized/base-zh
MOONSHINE_MODEL_ARCH=1
```

模型架构说明：
- `0` = Tiny (最快，准确率较低)
- `1` = Small (推荐，速度/准确率平衡)
- `2` = Medium (最高准确率)

### 4. 验证安装

```bash
# 测试 Moonshine 是否正常工作
python -c "from moonshine_voice import Transcriber; print('Moonshine installed successfully!')"
```

## 已修改的文件

| 文件 | 修改内容 |
|------|----------|
| `api/services/video_service.py` | 完全重写，使用 MoonshineService 替代 Whisper |
| `api/core/config.py` | 添加 MOONSHINE_MODEL_PATH 和 MOONSHINE_MODEL_ARCH 配置 |
| `api/requirements.txt` | 替换 openai-whisper 为 moonshine-voice |
| `api/pyproject.toml` | 替换 openai-whisper 为 moonshine-voice |
| `.env` | 添加 Moonshine 配置项 |
| `api/routers/video.py` | 更新错误消息中的引用 |

## 兼容性说明

Moonshine ASR 的输出格式已设计为与 Whisper 完全兼容：

```python
# 两种 API 都返回相同格式
{
    "text": "完整的转录文本",
    "segments": [
        {"start": 0.0, "end": 2.5, "text": "第一段文本"},
        {"start": 2.5, "end": 5.0, "text": "第二段文本"}
    ],
    "language": "zh"
}
```

因此，项目中其他使用 `video_service.transcribe_audio()` 的代码无需修改。

## 性能对比

| 指标 | Whisper Medium | Moonshine Small | Moonshine Tiny |
|------|----------------|-----------------|----------------|
| 转录速度 (30s 音频) | ~10-30 秒 | ~1-3 秒 | ~0.5 秒 |
| 内存占用 | ~500MB | ~200MB | ~100MB |
| 模型大小 | ~700MB | ~50MB | ~26MB |
| WER (错误率) | ~8.5% | ~7.8% | ~12% |

## 故障排除

### 问题 1: 导入错误

```
ModuleNotFoundError: No module named 'moonshine_voice'
```

**解决方案**:
```bash
pip install moonshine-voice
```

### 问题 2: 模型加载失败

```
Error: Model not found at path...
```

**解决方案**:
1. 确认已运行下载脚本
2. 检查 `.env` 中的 `MOONSHINE_MODEL_PATH` 是否正确
3. 确认路径使用正斜杠 `/` 或双反斜杠 `\\`

### 问题 3: 音频转换失败

```
Error converting audio to WAV
```

**解决方案**:
- 确认已安装 `ffmpeg-python`: `pip install ffmpeg-python`
- 确认系统 PATH 中有 ffmpeg 可执行文件

### 问题 4: 转录结果为空

**可能原因**:
- 音频文件无语音
- 模型语言不匹配（如用英文模型处理中文）

**解决方案**:
- 确认下载的是中文模型 (`--language zh`)
- 检查原始视频是否有音频轨道

## 回滚到 Whisper

如果遇到问题需要回滚：

1. 重新安装 Whisper:
```bash
pip install openai-whisper==20231117
```

2. 恢复 `api/services/video_service.py` 到 Git 版本:
```bash
git checkout api/services/video_service.py
```

3. 恢复 `requirements.txt` 和 `pyproject.toml`

## 后续优化建议

1. **批量处理优化**: Moonshine 支持批处理，可进一步优化 `process_video` 函数
2. **流式转录**: 使用 Moonshine 的流式 API 实现实时进度更新
3. **多语言自动检测**: 实现语言自动检测，动态选择模型

## 参考资料

- [Moonshine GitHub](https://github.com/moonshine-ai/moonshine)
- [Moonshine 研究论文](https://arxiv.org/abs/2602.12241)
- [Moonshine Hugging Face](https://huggingface.co/moonshine-ai)
