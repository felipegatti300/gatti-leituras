import os
import io
import asyncio
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import edge_tts

app = FastAPI(title="Leitor Neural TTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str
    voice: str = "pt-BR-AntonioNeural"  # pt-BR-AntonioNeural ou pt-BR-FranciscaNeural
    rate: str = "+0%"                  # ex: "+20%", "-10%"
    pitch: str = "+0Hz"

VOZES_DISPONIVEIS = [
    {"id": "pt-BR-AntonioNeural", "nome": "Antônio (Voz Natural - Brasil)", "genero": "Masculino"},
    {"id": "pt-BR-FranciscaNeural", "nome": "Francisca (Voz Natural - Brasil)", "genero": "Feminino"},
    {"id": "pt-BR-ThalitaNeural", "nome": "Thalita (Expressiva - Brasil)", "genero": "Feminino"},
    {"id": "pt-PT-DuarteNeural", "nome": "Duarte (Portugal)", "genero": "Masculino"},
    {"id": "pt-PT-RaquelNeural", "nome": "Raquel (Portugal)", "genero": "Feminino"},
    {"id": "en-US-GuyNeural", "nome": "Guy (Inglês EUA)", "genero": "Masculino"},
    {"id": "en-US-JennyNeural", "nome": "Jenny (Inglês EUA)", "genero": "Feminino"},
]

@app.get("/api/voices")
async def get_voices():
    return VOZES_DISPONIVEIS

@app.post("/api/tts")
async def gerar_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Texto não pode ser vazio")
    
    try:
        communicate = edge_tts.Communicate(
            text=req.text,
            voice=req.voice,
            rate=req.rate,
            pitch=req.pitch
        )
        audio_buffer = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.extend(chunk["data"])
                
        return Response(content=bytes(audio_buffer), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na síntese: {str(e)}")

# Servir o Frontend como PWA
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Inicia o servidor ouvindo na porta 8000 para acesso local e via rede local (WiFi do celular)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
