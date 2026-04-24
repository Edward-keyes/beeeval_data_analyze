import os
import json
import logging
import diskcache
import google.generativeai as genai
from typing import Optional

logger = logging.getLogger(__name__)

class TranslationService:
    def __init__(self):
        # Initialize DiskCache for persistence
        self.cache = diskcache.Cache(".translation_cache")
        
        # Ensure Gemini API key is set
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            logger.warning("GEMINI_API_KEY not found. Translation service may fail.")
        else:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel('gemini-1.5-pro')

    async def translate_text(self, text: str, target_lang: str = "en") -> str:
        """
        Translates text to target language using Gemini with caching.
        Handles technical terms and context intelligently.
        """
        if not text or not text.strip():
            return text

        # Check cache first
        cache_key = f"{target_lang}:{text}"
        cached_result = self.cache.get(cache_key)
        if cached_result:
            logger.debug(f"Cache hit for translation: {text[:20]}...")
            return cached_result
        
        # If text is very short and likely technical term/symbol/number, maybe skip?
        # For now, translate everything to be safe.

        try:
            logger.info(f"Translating text to {target_lang}: {text[:50]}...")
            
            # Prompt Engineering for Context-Aware Translation
            lang_name = "English" if target_lang == "en" else "Simplified Chinese"
            prompt = f"""
            You are a professional technical translator specializing in automotive and AI domains.
            Translate the following text to {lang_name}.
            
            **Rules:**
            1. Maintain the original meaning and tone.
            2. Preserve technical terms (e.g., 'latency', 'ASR', 'TTS') appropriately.
            3. Keep any code snippets, variable names, or markdown formatting intact.
            4. Do not add any conversational filler or explanations. Just output the translation.
            
            Text to translate:
            {text}
            """
            
            response = await self.model.generate_content_async(prompt)
            
            translated_text = response.text.strip()
            
            # Update cache
            self.cache.set(cache_key, translated_text, expire=None) # No expiration for static content
            
            return translated_text

        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return text  # Fallback to original text

translation_service = TranslationService()
