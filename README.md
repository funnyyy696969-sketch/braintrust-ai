# BrainTrust AI

**A Personal Environment for Understanding How AI Models Interpret Brain MRI Scans**

BrainTrust AI is a research space where you can upload brain MRI images, see how AI models
interpret them, and test whether those predictions hold up when the images are perturbed.
It is built for understanding, not for diagnosis.

## What You Can Do

- **Analyze MRI Scans**: Upload images and receive AI predictions with confidence scores
- **Visualize Model Attention**: See exactly where the model is focusing using Grad-CAM heatmaps
- **Perturb and Test**: Apply realistic changes to tumor regions and measure how predictions change
- **Measure Fragility**: Quantify prediction stability with OFI_res and statistical analysis
- **Deep Evaluation**: Run RMA, GAM analysis, and sanity checks to understand model behavior
- **Learn as You Go**: Built-in documentation explains what everything means and why it matters

## Technology Stack

### Frontend
- React 19
- TypeScript
- Vite
- Tailwind CSS (Minimalism theme)
- Recharts for visualization
- Lucide React icons
- Convex Auth for authentication

### Backend
- FastAPI
- Uvicorn
- Pydantic
- Python-Multipart

### AI/ML (Planned)
- PyTorch
- Torchvision
- ResNet50 / EfficientNet
- Captum for Grad-CAM
- NumPy, OpenCV, Pillow

## Getting Started

This is a personal project. You are the primary user. Everything is set up so you can
log in, upload your own scans, and explore what the models do with them.

### Running It

```bash
# Install dependencies
bun install

# Start the frontend
bun run dev
```

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run server
python -m app.main
```

The backend runs on `http://localhost:8000` if you want to use it.

### Project Layout

```
braintrust-ai/
├── frontend/                 # Everything you see in the browser
│   └── src/
│       ├── pages/           # The screens you interact with
│       └── ...
├── backend/                 # API that powers the analysis
│   └── app/
│       ├── api/            # Endpoints
│       └── ...
└── ...
```

## Pages

### Landing Page (`/`)
- Introduction to what BrainTrust AI is for
- Getting started call-to-action

### Sign In (`/auth`)
- Log in to access your workspace
- Guest access also available

### Dashboard (`/dashboard`)
- Your personal workspace
- Quick access to every part of the app

### Analyze MRI (`/mri-analysis`)
- Upload a scan
- Select a model
- See the prediction and confidence

### Explain (`/explainability`)
- View the scan
- Generate a Grad-CAM heatmap
- Adjust overlay to see where the model is looking

### Perturb (`/perturbation`)
- See the original scan
- Apply a perturbation
- Compare before and after

### Fragility (`/output-fragility`)
- See the original prediction
- See the perturbed prediction
- Understand how much the model changed its mind

### Evaluate (`/evaluation`)
- Run deeper checks on model behavior
- RMA, GAM analysis, and sanity checks

### Documentation (`/documentation`)
- Read about how things work
- Understand the methods and what to watch out for

### Settings (`/settings`)
- Configure your workspace
- Adjust settings to your preferences

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check and model status |
| `/api/predict` | POST | Predict from MRI image |
| `/api/gradcam` | POST | Generate Grad-CAM explanation |
| `/api/perturb` | POST | Apply perturbation |
| `/api/reinfer` | POST | Re-run inference on perturbed image |
| `/api/ofi` | POST | Calculate OFI_res |
| `/api/rma` | POST | Calculate Relevance Mass Accuracy |
| `/api/gam-analysis` | POST | Perform GAM analysis |

## Demo Mode

Right now the app runs in demo mode. That means:
- Predictions are simulated so you can see how the interface works
- Visualizations are generated on the fly for demonstration
- Real model inference requires integrating trained PyTorch models

To switch to real inference, you would integrate trained models and adjust the
backend configuration.

## Design

The look is clean and restrained. Nothing flashy. Everything is aligned carefully,
with room to breathe and just enough color to guide your eye.

### Colors
- White background
- Deep navy for headings and navigation (`#12355B`)
- Teal for the AI workflow (`#008C95`)
- Violet for Grad-CAM and explainability (`#6C4AB6`)
- Orange for perturbation and warnings (`#E58A2B`)
- Green for completed checks (`#2E8B57`)
- Soft gray cards (`#F3F6F9`)
- Dark charcoal text (`#263238`)

## A Note on What This Is

BrainTrust AI is a personal research environment. It is built for understanding how
AI models behave when they analyze brain MRI scans, not for clinical diagnosis.

The predictions, visualizations, and metrics you see are experimental. They are useful
for thinking critically about model reliability, but they are not validated clinical
tools and should not be used to make decisions about patients.

If you plan to use these ideas beyond personal exploration, bring in qualified
professionals and validate everything properly.

---

Built with React, FastAPI, Tailwind CSS, and Convex.
MIT License.
