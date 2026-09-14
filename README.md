# BrainTrust AI

**Inference-Time Manifold-Preserving Perturbation: An OOD-Resistant Output Fragility Framework**

A research prototype for evaluating AI reasoning in brain tumor MRI classification, built as a B.Tech Computer Science and Engineering project.

## Features

- **MRI Analysis**: Upload brain MRI images and obtain model predictions
- **Explainable AI**: Visualize Grad-CAM heatmaps to understand model decisions
- **Perturbation Analysis**: Apply manifold-preserving perturbations to test model robustness
- **Output Fragility**: Measure prediction fragility using OFI_res metric
- **Evaluation**: RMA, GAM analysis, and statistical evaluation tools
- **Research Framework**: Comprehensive documentation and methodology

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

### Prerequisites

- Node.js 18+
- Bun package manager
- Python 3.11+ (for backend)

### Frontend Setup

```bash
# Install dependencies
bun install

# Run development server
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

The backend will start on `http://localhost:8000`.

## Project Structure

```
braintrust-ai/
├── frontend/                 # React + TypeScript frontend
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Application pages
│   │   ├── services/        # API services
│   │   └── types/           # TypeScript types
│   └── ...
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/            # API routes
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── services/       # Business logic
│   │   └── ...
│   └── ...
├── models/                  # Model checkpoints
├── data/                    # Datasets
└── ...
```

## Pages

### Landing Page (`/`)
- Project overview and introduction
- Brain MRI-inspired illustration
- Call-to-action buttons

### Dashboard (`/dashboard`)
- Session overview and statistics
- Quick navigation to all features
- Model status information

### MRI Analysis (`/mri-analysis`)
- Image upload with drag-and-drop
- Model selection (ResNet50 / EfficientNet)
- Prediction results with probabilities
- Preprocessing information

### Explainability (`/explainability`)
- Original MRI display
- Grad-CAM heatmap visualization
- Saliency mask
- Adjustable overlay opacity

### Perturbation (`/perturbation`)
- Original vs perturbed image comparison
- Multiple perturbation methods
- Method descriptions and status

### Output Fragility (`/output-fragility`)
- Original and perturbed predictions
- OFI_res calculation
- Confidence comparison chart
- Formula explanation

### Evaluation (`/evaluation`)
- RMA evaluation (with ground truth)
- GAM analysis
- Casading weight randomization
- Export functionality

### Documentation (`/documentation`)
- Comprehensive methodology documentation
- Research context and limitations
- Expandable sections for each topic

### Settings (`/settings`)
- Application configuration
- API endpoint setup
- Model configuration

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

This application runs in demo mode by default. In demo mode:
- Predictions are simulated for testing
- Grad-CAM visualizations are synthetic
- Perturbation effects are demonstration-only
- Evaluation metrics use simulated data

To use real model inference, integrate trained PyTorch models and set `DEMO_MODE=false` in the backend configuration.

## Design

This project uses a **Minimalism theme** with:
- Clean, spacious layout
- Near-monochrome color palette
- Precise alignment
- Subtle dividers
- Intentional white space

### Color Palette
- White background: `#FFFFFF`
- Deep navy: `#12355B` (navigation, headings)
- Medical teal: `#008C95` (AI workflow)
- XAI violet: `#6C4AB6` (Grad-CAM)
- Perturbation orange: `#E58A2B` (perturbation)
- Validation green: `#2E8B57` (success states)
- Light blue-gray: `#F3F6F9` (cards)
- Charcoal text: `#263238`

## Research Context

This application is part of a B.Tech Computer Science and Engineering project focused on:
- Evaluating AI model robustness in medical imaging
- Understanding output fragility under perturbation
- Developing interpretable AI systems for healthcare

**Disclaimer**: This is a research prototype. It is not a clinical diagnostic tool and should not be used for medical decisions.

## License

MIT License - See LICENSE file for details.

## Acknowledgments

- Built with React, FastAPI, and Tailwind CSS
- Uses Convex for authentication
- Inspired by research in explainable AI and medical image analysis
