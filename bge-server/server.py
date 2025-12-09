"""
BGE-M3 Embedding Server
Simple Flask server for generating embeddings using BAAI/bge-m3 model.
"""

import os
import logging
from flask import Flask, request, jsonify
from FlagEmbedding import BGEM3FlagModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Load model on startup
logger.info("Loading BGE-M3 model...")
model = BGEM3FlagModel(
    "BAAI/bge-m3",
    use_fp16=True,  # Use half precision to save memory
    device="cpu"    # Force CPU (no GPU on Hetzner VPS)
)
logger.info("Model loaded successfully")


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok"})


@app.route("/embed", methods=["POST"])
def embed():
    """
    Generate embeddings for a list of texts.

    Request body:
        {"texts": ["text1", "text2", ...]}

    Response:
        {"embeddings": [[...], [...], ...]}
    """
    try:
        data = request.get_json()
        if not data or "texts" not in data:
            return jsonify({"error": "Missing 'texts' field"}), 400

        texts = data["texts"]
        if not isinstance(texts, list):
            return jsonify({"error": "'texts' must be a list"}), 400

        if len(texts) == 0:
            return jsonify({"embeddings": []})

        # Limit batch size to prevent OOM
        max_batch = int(os.environ.get("MAX_BATCH_SIZE", 32))
        if len(texts) > max_batch:
            return jsonify({
                "error": f"Batch size {len(texts)} exceeds maximum {max_batch}"
            }), 400

        # Generate embeddings
        logger.info(f"Generating embeddings for {len(texts)} texts")
        result = model.encode(
            texts,
            batch_size=min(len(texts), 8),
            max_length=512  # Limit token length for speed
        )

        # Extract dense vectors
        embeddings = result["dense_vecs"].tolist()

        return jsonify({"embeddings": embeddings})

    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/embed/single", methods=["POST"])
def embed_single():
    """
    Generate embedding for a single text.

    Request body:
        {"text": "some text"}

    Response:
        {"embedding": [...]}
    """
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' field"}), 400

        text = data["text"]
        if not isinstance(text, str):
            return jsonify({"error": "'text' must be a string"}), 400

        # Generate embedding
        result = model.encode([text], max_length=512)
        embedding = result["dense_vecs"][0].tolist()

        return jsonify({"embedding": embedding})

    except Exception as e:
        logger.error(f"Error generating embedding: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("DEBUG", "false").lower() == "true"

    logger.info(f"Starting server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
