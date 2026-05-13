import os
import subprocess
import tempfile
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

AUDIO_FILE = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator\Ai team討論.m4a"
OUTPUT_DIR = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator"
TRANSCRIPT_FILE = os.path.join(OUTPUT_DIR, "Ai_team_transcript.txt")
MEETING_NOTES_FILE = os.path.join(OUTPUT_DIR, "Ai_team_會議記錄.md")

client = OpenAI()

MEETING_NOTES_PROMPT = """你是一位專業的會議記錄整理員。請根據以下會議逐字稿，整理成一份完整的繁體中文會議記錄。

## 要求格式（Markdown）：

### 一、會議摘要
（3-5 句話概述本次會議的主要內容與結論）

### 二、行動項目
（條列所有需要跟進的事項，若有提及負責人請標註）

### 三、討論主題與重點
（依討論順序，列出各主題的重點摘要，每個主題獨立段落）

### 四、待釐清事項
（列出會議中尚未解決或需要進一步確認的問題，若無則寫「無」）

---

注意事項：
- 使用繁體中文撰寫
- 技術名詞保留英文
- 重點條列，清晰易讀

逐字稿如下：
---
{transcript}
---"""


def compress_audio(input_path):
    """壓縮音訊至 24MB 以內（Whisper 上限 25MB）"""
    file_size_mb = os.path.getsize(input_path) / 1024 / 1024
    print(f"原始檔案大小: {file_size_mb:.1f} MB")

    if file_size_mb <= 24:
        return input_path

    print("檔案超過 24MB，使用 ffmpeg 壓縮...")
    tmp_path = os.path.join(tempfile.gettempdir(), "ai_team_meeting_compressed.mp3")

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "32k",
        tmp_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 壓縮失敗: {result.stderr}")

    compressed_size_mb = os.path.getsize(tmp_path) / 1024 / 1024
    print(f"壓縮後大小: {compressed_size_mb:.1f} MB")
    return tmp_path


def transcribe_audio(file_path):
    """使用 OpenAI Whisper 轉錄音訊"""
    audio_path = compress_audio(file_path)
    print("開始轉錄（OpenAI Whisper）...")

    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language="zh",
            response_format="text",
        )

    if audio_path != file_path:
        os.remove(audio_path)

    print("轉錄完成！")
    return response


def generate_meeting_notes(transcript):
    """使用 GPT-4.1 整理會議記錄"""
    print("根據逐字稿生成會議記錄（GPT-4.1）...")
    prompt = MEETING_NOTES_PROMPT.replace("{transcript}", transcript)

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": "你是一位精通科技產業的專業會議記錄員，擅長整理繁體中文技術會議記錄。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=4000,
    )
    print("會議記錄生成完成！")
    return response.choices[0].message.content


def main():
    print("=" * 60)
    print("AI Team 會議轉錄與記錄產生器")
    print("=" * 60)

    print("\n--- 步驟一：音訊轉錄 ---")
    transcript = transcribe_audio(AUDIO_FILE)

    with open(TRANSCRIPT_FILE, "w", encoding="utf-8") as f:
        f.write(transcript)
    print(f"逐字稿已儲存至: {TRANSCRIPT_FILE}")
    print(f"逐字稿長度: {len(transcript)} 字元")

    print("\n--- 步驟二：整理會議記錄 ---")
    meeting_notes = generate_meeting_notes(transcript)

    with open(MEETING_NOTES_FILE, "w", encoding="utf-8") as f:
        f.write("# AI Team 會議記錄\n\n")
        f.write("> 音訊來源：Ai team討論.m4a\n")
        f.write("> 轉錄：OpenAI Whisper | 整理：GPT-4.1\n\n")
        f.write("---\n\n")
        f.write(meeting_notes)
    print(f"會議記錄已儲存至: {MEETING_NOTES_FILE}")

    print("\n" + "=" * 60)
    print("完成！")
    print(f"  逐字稿: {TRANSCRIPT_FILE}")
    print(f"  會議記錄: {MEETING_NOTES_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
