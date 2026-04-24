# ASR 转录测试脚本使用说明

## 功能说明

这个脚本用于单独测试 ASR 模型的音频提取和转录能力，不包含 LLM 评估环节。适用于：

- 对比不同 ASR 模型的转录准确率
- 测试特定视频文件的转录效果
- 评估 ASR 模型的性能指标（速度、RTF 等）

## 使用方法

### 基本语法

```bash
cd D:\data\project_IntelliJ\BeeEVAL\api
.\venv\Scripts\activate
python test_asr.py <视频路径> [--model 模型名称] [--output 输出文件]
```

### 参数说明

| 参数 | 说明 | 默认值 | 选项 |
|------|------|--------|------|
| `video_path` | 视频文件路径（必填） | - | - |
| `--model, -m` | ASR 模型选择 | `moonshine` | `moonshine`, `whisper`, `funasr` |
| `--output, -o` | 结果输出文件路径 | 不保存 | 任意 JSON 文件路径 |
| `--no-log` | 禁用详细日志 | 否 | - |

## 使用示例

### 1. 使用 Moonshine 测试（默认）

```bash
python test_asr.py "C:/测试视频/4064-小米 Yu7.mp4"
```

### 2. 使用 FunASR 测试并保存结果

```bash
python test_asr.py "C:/测试视频/4064-小米 Yu7.mp4" -m funasr -o funasr_result.json
```

### 3. 使用 Whisper 测试

```bash
python test_asr.py "C:/测试视频/4064-小米 Yu7.mp4" -m whisper
```

### 4. 对比测试（三个模型都跑）

```bash
# 测试 Moonshine
python test_asr.py "C:/测试视频/test.mp4" -m moonshine -o moonshine.json

# 测试 FunASR
python test_asr.py "C:/测试视频/test.mp4" -m funasr -o funasr.json

# 测试 Whisper
python test_asr.py "C:/测试视频/test.mp4" -m whisper -o whisper.json

# 然后对比三个 JSON 文件的转录文本
```

## 输出说明

### 控制台输出

```
==================================================
Step 1: Extracting audio from video...
Audio extracted to: D:\data\project_IntelliJ\BeeEVAL\api\temp_files\test.mp3
Audio extraction time: 2.34s
==================================================
Step 2: Transcribing audio...
Transcription completed in: 3.21s
==================================================
TRANSCRIPTION SUMMARY
==================================================
Full Text (156 chars):
--------------------------------------------------
欢迎使用智能座舱系统，请问有什么可以帮您？
--------------------------------------------------

Segments with timestamps:
  [1] 0.00s - 2.50s: 欢迎使用智能座舱系统
  [2] 2.50s - 5.00s: 请问有什么可以帮您？
==================================================
METRICS
==================================================
  audio_extract_time_sec: 2.34
  transcription_time_sec: 3.21
  total_duration_sec: 5.55
  text_length: 156
  words_count: 2
  rtf: 0.64
  audio_duration_sec: 5.0
```

### JSON 输出文件

```json
{
  "video_path": "C:/测试视频/4064-小米 Yu7.mp4",
  "asr_model": "funasr",
  "timestamp": "2026-03-16T16:45:30.123456",
  "metrics": {
    "audio_extract_time_sec": 2.34,
    "transcription_time_sec": 3.21,
    "total_duration_sec": 5.55,
    "text_length": 156,
    "words_count": 2,
    "rtf": 0.64,
    "audio_duration_sec": 5.0
  },
  "transcript": {
    "full_text": "欢迎使用智能座舱系统，请问有什么可以帮您？",
    "segments": [
      {"start": 0.0, "end": 2.5, "text": "欢迎使用智能座舱系统"},
      {"start": 2.5, "end": 5.0, "text": "请问有什么可以帮您？"}
    ],
    "language": "zh",
    "segment_count": 2
  },
  "error": null
}
```

## 性能指标说明

| 指标 | 说明 | 评价标准 |
|------|------|----------|
| **audio_extract_time_sec** | 音频提取耗时（秒） | 越短越好 |
| **transcription_time_sec** | 转录耗时（秒） | 越短越好 |
| **total_duration_sec** | 总耗时 | 越短越好 |
| **rtf** | 实时因子 (转录时间/音频时长) | <1 表示实时，越小越好 |
| **text_length** | 转录文本长度（字符数） | 参考指标 |
| **words_count** | 词数 | 参考指标 |
| **audio_duration_sec** | 音频时长 | 参考指标 |

## 各 ASR 模型特点

| 模型 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **Moonshine** | 速度最快，资源占用低 | 中文模型只有 Small 版本 | 追求速度，实时性要求高 |
| **FunASR** | 中文准确率最高，带标点 | 依赖较多 | 中文场景，追求准确率 |
| **Whisper** | 多语言支持好 | 速度慢，资源占用高 | 多语言混合场景 |

## 常见问题

### Q1: 导入错误 `ModuleNotFoundError: No module named 'funasr'`

确保已安装依赖：
```bash
pip install funasr>=1.1.0 modelscope>=1.9.0
```

### Q2: Moonshine 模型未找到

确保已下载 Moonshine 模型，见 `api/download_moonshine_model.py`

### Q3: 音频提取失败

确保系统已安装 ffmpeg，并添加到 PATH

### Q4: 转录结果为空

- 检查视频是否有音频轨道
- 尝试换用其他 ASR 模型
- 检查音频格式是否兼容

## 批处理测试

如需批量测试多个视频，可以创建批处理脚本：

```bash
@echo off
REM batch_test.bat

set VIDEO_DIR=C:\测试视频
set OUTPUT_DIR=D:\asr_test_results

for %%f in ("%VIDEO_DIR%\*.mp4") do (
    echo Testing %%~nxf with Moonshine...
    python test_asr.py "%%f" -m moonshine -o "%OUTPUT_DIR%\%%~nf_moonshine.json"

    echo Testing %%~nxf with FunASR...
    python test_asr.py "%%f" -m funasr -o "%OUTPUT_DIR%\%%~nf_funasr.json"
)

echo All tests completed!
```

## 结果对比技巧

1. **查看转录准确率**：对比 `transcript.full_text` 字段
2. **查看性能**：对比 `metrics.rtf` 和 `metrics.transcription_time_sec`
3. **查看时间戳精度**：对比 `transcript.segments` 中的时间戳

推荐使用 JSON 对比工具（如 VS Code 的 Compare Folders 插件）来对比不同模型的输出。
