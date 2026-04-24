from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.services.translation_service import translation_service
import logging

router = APIRouter(prefix="/api/translate", tags=["Translate"])
logger = logging.getLogger(__name__)

class TranslateRequest(BaseModel):
    text: str
    target_lang: str

@router.post("")
async def translate_text(request: TranslateRequest):
    try:
        translated = await translation_service.translate_text(request.text, request.target_lang)
        return {"original": request.text, "translated": translated}
    except Exception as e:
        logger.error(f"Translation API error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
