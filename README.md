# BrainTrust AI

**Inference-Time Manifold-Preserving Perturbation: an OOD-Resistant Output Fragility Framework** — a research prototype for evaluating how much a brain-MRI classifier's output changes when the region it *says* it is looking at is realistically perturbed.

Not a clinical tool. No diagnosis, no staging, no clinical claims.

---

## What it does

1. **Inspect** — one uploaded file (PNG, JPG, multi-page TIFF, DICOM single- or multi-frame, NIfTI `.nii`/`.nii.gz`, ZIP) is identified by **magic bytes**, never by extension. The report shows file type, structure (single / composite / slice-stack / volume / archive), image/slice/frame count, dimensions, channels, bit depth, series info, and voxel spacing when available.
2. **Extract** — composites are split into panels via gutter detection (content-agnostic, works on white or black backgrounds); volumes are sliced along a chosen axis; multi-frame files become frames. Crops are always taken from the original full-resolution image — nothing is stretched, rotated, or shrunk before cropping. A manual grid override is available when detection is unsure.
3. **Analyze per image** — every extracted image gets its **own** pipeline run: preprocess → classify → Grad-CAM → salient-region perturbation → re-classify → OFI<sub>res</sub>. Results are never shared between images.
4. **Review** — per-image dashboard with original/Grad-CAM/saliency/perturbed views, side-by-side predictions, per-image OFI<sub>res</sub>, group-level summary (clearly labelled as an aggregation), and charts.

### OFI<sub>res</sub>

```
OFI_res = ( p_orig(target) − p_perturbed(target) ) / ( p_orig(target) + ε )
```

`target` = the class predicted on the clean image. ≈ 0 → robust; ≈ 1 → confidence collapsed; > 1 → flipped. Version: `OFI_res-v1.0` — **a project-defined metric, not a clinically validated standard.** Values below the 35 % baseline-confidence floor are flagged unreliable rather than silently reported.

### Honest limits

- The browser build runs a **deterministic pixel-statistics surrogate** ("Demo Mode"), not a trained network — predictions and Grad-CAM are consistent with each other but are **not** medical output. No RNG anywhere: identical input always yields identical output.
- The desktop backend **refuses to analyze without a trained checkpoint** instead of simulating one.
- Tumor stage/grade is **not** predicted anywhere. Grad-CAM is an attention explanation, not segmentation.

---

## Architecture

```
src/
  lib/imaging/           browser analysis core (TypeScript)
    fileInspection.ts      magic-byte detection, structure report
    compositeDetection.ts  gutter grid detection + full-res panel extraction
    sliceExtraction.ts     TIFF pages, DICOM frames, NIfTI slices, ZIP entries
    extraction.ts          router → correct extractor
    preprocessing.ts       luma → 224² → normalise
    prediction.ts          deterministic demo classifier
    gradcam.ts             Grad-CAM surrogate, jet heatmap, saliency mask
    perturbation.ts        salient-region-only blur/pixelate/brightness/noise
    fragility.ts           OFI_res v1.0
    analysisPipeline.ts    per-image orchestration + group summary
    sessionStore.ts        in-memory image session (pixels never uploaded)
  pages/
    UploadInspection.tsx     Upload & File Inspection
    ExtractionReview.tsx     Image Extraction Review (accept/reject + manual grid)
    MultiImageAnalysis.tsx   Multi-Image Analysis dashboard
    ImageDetail.tsx          Individual Image Detail (Grad-CAM/overlay/OFI card)
    OfiDashboard.tsx         OFI_res Dashboard (charts, aggregation, caveats)
  convex/
    schema.ts                scans / images / auditLog tables
    scans.ts                 persistence + audit API

backend/                 desktop backend (Python 3.10+)
  training/
    prepare_data.py           Kaggle dataset → train/val ImageFolder layout
    train.py                  ResNet-50 fine-tune → backend checkpoint
    evaluate_checkpoint.py    pre-release validation (blocks at chance level)
  services/
    file_inspection_service.py
    composite_detection_service.py
    image_extraction_service.py
    dicom_service.py          (PII-safe)
    nifti_service.py
    preprocessing_service.py  (inside prediction_service.preprocess)
    prediction_service.py     checkpoint-gated
    gradcam_service.py        Captum LayerGradCam
    perturbation_service.py
    fragility_service.py
    multi_image_analysis_service.py
    evaluation_service.py
  tests/
    test_extraction.py        1/4/9-panel, multi-frame, 3D volume cases
    test_fragility.py         OFI_res maths + guard
  app/main.py               FastAPI routes: /api/inspect /api/extract /api/analyze
```

---

## Running

### Web app (this environment — no setup needed)

```bash
bun install
bun convex dev --once   # deploy Convex functions
bun tsc -b --noEmit     # typecheck
bun run dev             # or just open the preview
```

### Desktop backend (Windows / VS Code)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Model checkpoint setup — train your own tumor classifier

The backend looks for:

```
backend/checkpoints/brain_mri_resnet50.pt
```

**Option A — train it yourself (recommended, ~20 min on Kaggle's free GPU):**

1. **Download the dataset** (free account): [Kaggle — Brain Tumor MRI Dataset](https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset) → unzip to e.g. `C:/datasets/brain-mri/` (contains `Training/` and `Testing/` with the 4 class folders).

2. **Install training dependencies** (Windows / VS Code terminal):

    ```powershell
    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    ```

3. **Organise the dataset** into `train/` + `val/` ImageFolder layout:

    ```powershell
    python -m training.prepare_data --src "C:/datasets/brain-mri"
    python -m training.prepare_data --verify-only   # sanity check
    ```

4. **Train** (ResNet-50 fine-tune, 1-channel MRI input, class-weighted loss, early stopping on val macro-F1):

    ```powershell
    python -m training.train --data data/processed --epochs 25
    ```

    Typical result on this dataset: **val accuracy ≈ 96–99 %**, macro-F1 ≈ 0.96+. The best checkpoint is written automatically to `backend/checkpoints/brain_mri_resnet50.pt` (archive copy + training history in `training/runs/<timestamp>/`).

5. **Evaluate before trusting it** (blocks at chance level):

    ```powershell
    python -m training.evaluate_checkpoint
    ```

6. **Serve** — analysis now unlocks:

    ```powershell
    uvicorn app.main:app --port 8000
    curl http://localhost:8000/health    # → "checkpoint_available": true
    ```

    Grad-CAM (Captum `LayerGradCam` on `layer4`) and per-image OFI_res immediately work against the real model — every heatmap comes from the same tensor that produced the prediction.

**Option B — Kaggle notebook:** run steps 3–4 in a notebook with the dataset attached as `/kaggle/input`, GPU T4 on, then `torch.save(model, "/kaggle/working/brain_mri_resnet50.pt")`, download it, and place it at `backend/checkpoints/brain_mri_resnet50.pt`.

**Expected checkpoint contract:** a `torch.nn.Module` taking `1×1×224×224` normalised input (luma, mean 0.449, std 0.226) with a 4-logit head ordered `[Glioma, Meningioma, "No Tumor", Pituitary]`.

Until the checkpoint exists, `POST /api/analyze` returns **503** by design — the backend never simulates medical output. The web app keeps running in clearly-labelled Demo Mode.

Unit tests cover the training plumbing too (class normalisation, model contract, preprocessing parity between training and serving):

### Tests

```bash
cd backend
pytest tests -q          # Python: extraction + OFI_res + training plumbing
bunx vitest run          # browser: prediction determinism + OFI maths + grid layouts
```

---

## Sample demo images

Create quick composites locally for testing (no patient data needed):

```python
from tests.test_extraction import _composite
_composite(2, 2).save("demo-2x2.png")   # 4-panel composite
_composite(3, 3).save("demo-3x3.png")   # 9-panel composite
_composite(1, 1).save("demo-single.png")
```

## Audit log

Every inspect / extract / manual-correction / per-image analysis event is recorded in the `auditLog` Convex table with timestamps — extraction and analysis operations are traceable per scan.
