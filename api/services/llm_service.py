from openai import OpenAI
from api.core.config import settings
import os
import base64
import json
from datetime import datetime
from api.core.logger import logger
from api.services.metric_service import metric_service

# LLM 输入输出日志文件路径
LLM_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "llm_logs")
os.makedirs(LLM_LOG_DIR, exist_ok=True)


class LLMService:
    def __init__(self):
        import httpx
        # Prioritize config.py settings, fallback to hardcoded if env missing
        base_url = settings.LLM_BASE_URL
        if not base_url or base_url.endswith("/chat/completions"):
             # Clean base URL if it contains the endpoint path, as OpenAI client appends it
             base_url = "https://ai.juguang.chat/v1"

        # Create httpx client explicitly without proxies.
        # trust_env=False: ignore HTTP_PROXY / HTTPS_PROXY env vars so local
        # Clash/V2Ray/VPN don't silently hijack LLM traffic. If you actually
        # need a proxy, pass proxies=... explicitly here.
        httpx_client = httpx.Client(timeout=90.0, trust_env=False)

        self.client = OpenAI(
            api_key=settings.LLM_API_KEY,
            base_url=base_url,
            timeout=90.0,  # Increased timeout for complex multi-case analysis
            max_retries=1,
            http_client=httpx_client
        )
        self.model = settings.LLM_MODEL

    async def evaluate_video(self, transcript_data: dict, criteria: list[str], image_path: str = None, language: str = "zh") -> str:
        # Format transcript with timestamps
        formatted_transcript = ""
        for seg in transcript_data.get("segments", []):
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            text = seg.get("text", "")
            formatted_transcript += f"[{start:.2f}s - {end:.2f}s]: {text}\n"

        target_lang_prompt = "CHINESE (Simplified Chinese)" if language == "zh" else "ENGLISH"

        # 获取指标分类文本（用于 Prompt）
        metrics_categories_prompt = metric_service.get_prompt_categories()

        # 获取指标定义文本（用于 Prompt）
        metrics_definitions_prompt = metric_service.get_prompt_metrics_definitions()

        prompt_text = f"""
你是智能座舱 AI 评测专家。请基于以下转录内容（包含时间戳）和系统界面截图，对 AI 的性能进行全面评估。

**重要：请所有分析、反馈和总结都使用{target_lang_prompt}。**

【转录内容】
{formatted_transcript}

{metrics_categories_prompt}

【任务要求】

1. **识别 Case**：从转录中识别用户与系统的交互对话。一个 Case 通常包含一轮或多轮完整的对话（用户问题 + 系统回答）。如果视频中有多轮对话，请根据语义判断是拆分成多个 Case 还是合并为一个整体 Case。

2. **为每个 Case 进行评估**：
   - 从上述指标分类中，为每个 Case 选择**最相关的 3-5 个指标**进行评估
   - 指标选择理由：说明为什么这些指标与当前 Case 相关
   - 所有评分统一使用 **1-5 分制**（5 分最佳，可以使用 0.5 增量，如 3.5, 4.0, 4.5）

   **指标选择判断标准**（根据转录内容特征匹配）：
   {metrics_definitions_prompt}

3. **整体质量评分**：为每个 Case 给出一个独立的"回复质量"整体评分（**必须是 1、2、3、4、5 之一的整数，不能出现小数如 4.5**），这是基于整体感受的独立评分，不依赖于具体指标分数

4. **首响延时计算**：如果可以从转录中识别时间信息，请计算首响延时。计算公式：(系统回答开始时间 - 用户问题结束时间) × 1000，单位为毫秒

5. **评价总结**：为每个 Case 提供一个简短的总结，重点描述回复质量为什么好或不好

6. **UI/UX 评价**：如果提供了截图，请对界面的清晰度、美观性和相关性进行评价

【输出格式要求】

请输出严格的 JSON 格式，包含以下结构：

{{
  "cases": [
    {{
      "user_question": "用户问题内容（完整，不要截断）",
      "system_response": "系统回答内容（完整，不要截断）",
      "response_quality_score": 4,
      "latency_ms": 1200,
      "summary": "针对该 Case 的评价总结，重点描述回复质量",
      "ui_ux_feedback": "UI/UX 评价（如果有截图）",
      "matched_metrics": [
        {{
          "metric_code": "C33",
          "metric_name": "复杂指令识别",
          "category": "认知 - 意图识别",
          "score": 4,
          "feedback": "详细的评价反馈内容",
          "selection_reason": "解释为什么选择这个指标"
        }}
      ]
    }}
  ]
}}

**注意事项**：
- 如果转录中包含多组问答，请在 cases 数组中输出多个 Case
- 每个 Case 的 matched_metrics 数组应包含 3-5 个最相关的指标
- **所有评分（response_quality_score 和 score）都必须是 1、2、3、4、5 之一的整数，绝对不能输出 3.5、4.0、4.5 这样带小数点的值**
- response_quality_score 是独立评分，不与指标分数平均
"""

        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
        ]

        user_content = [{"type": "text", "text": prompt_text}]

        if image_path and os.path.exists(image_path):
            try:
                # import base64 # Already imported at top
                with open(image_path, "rb") as image_file:
                    base64_image = base64.b64encode(image_file.read()).decode('utf-8')
                
                user_content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}"
                    }
                })
            except Exception as e:
                logger.error(f"Error encoding image for LLM: {e}")

        messages.append({"role": "user", "content": user_content})

        try:
            logger.info("Sending request to LLM...")

            # 记录 LLM 输入
            llm_input = {
                "timestamp": datetime.now().isoformat(),
                "model": self.model,
                "messages": messages,
                "transcript_summary": {
                    "segment_count": len(transcript_data.get("segments", [])),
                    "full_text_length": len(formatted_transcript),
                    "language": language
                },
                "criteria": criteria,
                "has_image": image_path is not None and os.path.exists(image_path)
            }

            # 保存输入到文件
            input_log_path = os.path.join(
                LLM_LOG_DIR,
                f"llm_input_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.json"
            )
            with open(input_log_path, 'w', encoding='utf-8') as f:
                json.dump(llm_input, f, ensure_ascii=False, indent=2)
            logger.info(f"LLM input saved to: {input_log_path}")

            # Retry logic for LLM calls
            max_retries = 3
            retry_delay = 2.0  # seconds
            last_error = None

            for attempt in range(max_retries):
                try:
                    response = self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        response_format={"type": "json_object"}
                    )
                    logger.info(f"Received response from LLM (attempt {attempt + 1}/{max_retries})")

                    # 记录 LLM 输出
                    usage = getattr(response, "usage", None)
                    llm_output = {
                        "timestamp": datetime.now().isoformat(),
                        "input_log_path": input_log_path,
                        "model": self.model,
                        "response": response.choices[0].message.content,
                        "usage": {
                            "prompt_tokens": usage.prompt_tokens if usage else None,
                            "completion_tokens": usage.completion_tokens if usage else None,
                            "total_tokens": usage.total_tokens if usage else None
                        } if usage else None
                    }

                    # 保存输出到文件
                    output_log_path = os.path.join(
                        LLM_LOG_DIR,
                        f"llm_output_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.json"
                    )
                    with open(output_log_path, 'w', encoding='utf-8') as f:
                        json.dump(llm_output, f, ensure_ascii=False, indent=2)
                    logger.info(f"LLM output saved to: {output_log_path}")

                    return response.choices[0].message.content

                except Exception as retry_error:
                    last_error = retry_error
                    # Surface the underlying cause – OpenAI SDK often wraps
                    # httpx errors and prints only "Connection error." which
                    # makes debugging impossible. Dig one level deeper.
                    cause = getattr(retry_error, "__cause__", None) or getattr(retry_error, "__context__", None)
                    detail = f"{type(retry_error).__name__}: {retry_error}"
                    if cause:
                        detail += f" | cause: {type(cause).__name__}: {cause}"
                    logger.warning(f"LLM call failed (attempt {attempt + 1}/{max_retries}) [{detail}]")
                    if attempt < max_retries - 1:
                        import time
                        logger.info(f"Retrying in {retry_delay}s...")
                        time.sleep(retry_delay)
                        retry_delay *= 1.5  # Exponential backoff
                    continue

            # All retries failed
            logger.error(f"LLM call failed after {max_retries} attempts: {last_error}")
            # Return structured error info instead of empty JSON
            return json.dumps({
                "error": "LLM service unavailable",
                "error_message": str(last_error),
                "cases": []
            })

        except Exception as e:
            logger.error(f"LLM Unexpected Error: {e}")
            return json.dumps({
                "error": "LLM unexpected error",
                "error_message": str(e),
                "cases": []
            })

    async def chat_with_prompt(self, prompt: str, system_message: str = "你是智能座舱 AI 评测助手。") -> str:
        """
        简单的 prompt 对话接口（用于 RAG）

        Args:
            prompt: 用户提示词
            system_message: 系统消息

        Returns:
            大模型回复文本
        """
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": prompt}
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=1024
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Chat completion failed: {e}")
            return f"抱歉，大模型服务暂时不可用：{e}"


llm_service = LLMService()
