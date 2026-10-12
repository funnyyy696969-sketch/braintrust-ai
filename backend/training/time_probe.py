"""Timing probe: how long do phantoms + one train step take in this sandbox?"""
import sys, time
sys.path.insert(0, "backend")
import numpy as np

t = time.time()
from training.random_cam_sanity import make_image
from training.train_cnn import BrainCamNet
print("import:", round(time.time() - t, 2), "s", flush=True)

t = time.time()
for _ in range(20):
    make_image(0)
print("20 phantoms:", round(time.time() - t, 2), "s", flush=True)

import torch
torch.set_num_threads(2)
m = BrainCamNet.build()
x = torch.randn(1, 1, 224, 224)
t = time.time()
y = m(x)
y[0].sum().backward()
print("1 fwd+bwd:", round(time.time() - t, 2), "s", flush=True)
t = time.time()
for _ in range(5):
    y = m(torch.randn(4, 1, 224, 224))
    m(x).sum().backward()
print("5 batch-4 fwd+bwd:", round(time.time() - t, 2), "s", flush=True)
