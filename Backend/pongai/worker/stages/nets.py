"""
pongai.worker.stages.nets — the two trained models.

Architectures must match the checkpoints exactly. Two choices here were
deliberate and should not be "simplified":

DetNet keeps FULL temporal resolution. A U-Net encoder/decoder is the obvious
shape for per-frame prediction, but every stride-2 layer blurs peak location
and this model is scored at +/-8 frames. Dilation reaches 2,033 frames of
context without losing precision.

ClsNet uses ATTENTION POOLING, not the last hidden state. Contact sits at the
centre of the 97-frame window (index 60); reading the final timestep would
force the decisive moment through 36 steps of decay.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class Block(nn.Module):
    """Dilated residual block, length-preserving."""

    def __init__(self, c: int, d: int, drop: float = 0.1):
        super().__init__()
        self.c1 = nn.Conv1d(c, c, 5, padding=2 * d, dilation=d)
        self.c2 = nn.Conv1d(c, c, 5, padding=2 * d, dilation=d)
        self.n1, self.n2 = nn.BatchNorm1d(c), nn.BatchNorm1d(c)
        self.do = nn.Dropout(drop)

    def forward(self, x):
        r = x
        x = self.do(F.gelu(self.n1(self.c1(x))))
        x = self.do(F.gelu(self.n2(self.c2(x))))
        return F.gelu(x + r)


class DetNet(nn.Module):
    """Per-frame contact probability + side attribution.

    Input 170 channels: both players x (34 keypoint coords + 34 velocities +
    17 confidences).
    """

    def __init__(self, c_in: int, w: int = 128):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(c_in, w, 1), nn.BatchNorm1d(w), nn.GELU())
        self.blocks = nn.Sequential(
            *[Block(w, d) for d in (1, 2, 4, 8, 16, 32, 64)])
        self.hc = nn.Conv1d(w, 1, 1)     # contact
        self.hs = nn.Conv1d(w, 1, 1)     # side

    def forward(self, x):
        z = self.blocks(self.stem(x))
        return self.hc(z).squeeze(1), self.hs(z).squeeze(1)


class AttnPool(nn.Module):
    def __init__(self, c: int):
        super().__init__()
        self.score = nn.Conv1d(c, 1, 1)

    def forward(self, x):
        w = torch.softmax(self.score(x), -1)
        return torch.cat([(x * w).sum(-1), x.max(-1).values], -1)


class ClsNet(nn.Module):
    """4-class stroke + 8-way technique.

    Input 86 channels: striker only x (34 coords + 34 velocities + 17 valid
    flags + 1 table distance).
    """

    def __init__(self, c_in: int, w: int = 128):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(c_in, w, 1), nn.BatchNorm1d(w), nn.GELU())
        self.blocks = nn.Sequential(
            *[Block(w, d, 0.2) for d in (1, 2, 4, 8, 16, 32)])
        self.pool = AttnPool(w)
        self.trunk = nn.Sequential(
            nn.Linear(w * 2, 256), nn.GELU(), nn.Dropout(0.3))
        self.shot = nn.Linear(256, 4)
        self.tech = nn.Linear(256, 8)

    def forward(self, x):
        z = self.trunk(self.pool(self.blocks(self.stem(x))))
        return self.shot(z), self.tech(z)
