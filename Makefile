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

bfree:           ## B-Free (GRIP, nonprofit licence): code at a pinned full commit + weights, SHA-256 checked
	mkdir -p models/bfree
	test -d models/bfree/repo || git clone -q https://github.com/grip-unina/B-Free.git models/bfree/repo
	git -C models/bfree/repo -c advice.detachedHead=false checkout -q --detach c6a9f898782fb466b29af01f21960b67415afb0e^{commit}
	test "$$(git -C models/bfree/repo rev-parse HEAD)" = c6a9f898782fb466b29af01f21960b67415afb0e
	ok() { test "$$(shasum -a 256 models/bfree/BFREE_dino2reg4.zip 2>/dev/null | cut -d' ' -f1)" = "8230fd3f0f3a64a6403acb692ce1663718ed16f36a5a4de4a68c0d273781769f"; }; \
	ok || curl -L -C - --retry 5 -o models/bfree/BFREE_dino2reg4.zip https://www.grip.unina.it/download/prog/B-Free/weights/BFREE_dino2reg4.zip; \
	ok || { echo "B-Free weights failed the SHA-256 check"; exit 1; }
	unzip -oq models/bfree/BFREE_dino2reg4.zip -d models/bfree/weights

api:             ## FastAPI backend for the React UI (localhost:8000)
	uv run corncam api

web:             ## React UI dev server (localhost:5173, proxies /api)
	cd web && pnpm exec vite --port 5173

web-check:       ## type-check + lint the React UI
	cd web && pnpm exec tsc -b && pnpm exec eslint src
