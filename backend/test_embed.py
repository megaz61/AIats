import os
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()
hf_api_key = os.getenv("HF_API_KEY")
client_embed = InferenceClient(token=hf_api_key)

try:
    print("Testing embedding...")
    data = client_embed.feature_extraction("Test text", model="sentence-transformers/all-MiniLM-L6-v2")
    print("Success. Type:", type(data))
except Exception as e:
    print("Error:", str(e))
