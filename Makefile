.PHONY: test lint fmt detect serve models api web web-check

test:            ## unit tests (no model downloads)
	uv run pytest -q

lint:            ## ruff lint
	uv run ruff check src tests

fmt:             ## ruff format
	uv run ruff format src tests

detect:          ## make detect FILES="data/samples/*.jpg"
	uv run corncam detect $(FILES)

serve:           ## local web UI on http://127.0.0.1:7860
	uv run corncam serve

models:          ## pre-download pinned detector weights
	hf download abacusai/Smaug-AI-Image-Detector --revision c7c95951e04a87b884a4ad479401b1128c3903bd
	hf download yermandy/GenD_CLIP_L_14 --revision 891ce014a0308386c4d7d25b3dcf436a22db5504
	hf download Sadanie/pellav2-audio-deepfake-detector --revision 29daea8b04acf2d3f11d1d0da6b01c17fc8a1e4b
	mkdir -p models && curl -sL -o models/face_detection_yunet_2026may.onnx https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet/face_detection_yunet_2026may.onnx

api:             ## FastAPI backend for the React UI (localhost:8000)
	uv run corncam api

web:             ## React UI dev server (localhost:5173, proxies /api)
	cd web && pnpm exec vite --port 5173

web-check:       ## type-check + lint the React UI
	cd web && pnpm exec tsc -b && pnpm exec eslint src
