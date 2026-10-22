#!/usr/bin/env python3
"""Converte Engome.obj (exportado do Fusion, em cm, Z-up) para assets/engome.glb (mm, Z-up).

Mantém os nomes de nó usados por assets/engome-parts.json e aplica materiais PBR
baseados no Engome.mtl. O Fusion não exporta imagens de textura, então a veia da
madeira é gerada proceduralmente (textura contínua) e mapeada pelos UVs do bojo.

Uso: python3 tools/convert-obj.py
"""
import io
import json
import re
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OBJ = ROOT / "Engome.obj"
OUT = ROOT / "assets" / "engome.glb"
PARTS_OUT = ROOT / "assets" / "engome-parts.json"

SCALE = 10.0          # cm -> mm
WOOD_TILE_CM = 25.0   # lado de um ladrilho da textura de madeira, em cm

# Cores Kd do Engome.mtl (sRGB)
KD_WOOD = (0.435294, 0.325490, 0.207843)
KD_STEEL = (0.627451, 0.627451, 0.627451)
# No Engome.mtl o couro saiu com Kd preto (o Fusion não exporta a textura do couro);
# usamos um tom de couro envelhecido.
KD_LEATHER = (0.62, 0.45, 0.29)


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------- nomes
def node_key(group):
    """Nome do grupo no OBJ -> chave usada em engome-parts.json."""
    simple = {
        "Macaíba": "bojo",
        "Arquilha Externa": "arquilha_externa",
        "Arquilha Interna": "arquilha_interna",
        "Aro de Cima": "aro_cima",
        "Aro de Baixo": "aro_baixo",
        "Arquilha do Couro": "arquilha_couro",
        "Base": "base_circular",
        "Couro": "couro",
    }
    if group in simple:
        return simple[group]
    m = re.match(r"Esticador (\d+)", group)
    if m:
        return f"esticador_{m.group(1)}"
    m = re.match(r"Pé (\d+)", group)
    if m:
        return f"pe_{m.group(1)}"
    if group.startswith("Orelha"):
        return None  # numeradas depois, em ordem estável
    raise ValueError(f"grupo desconhecido: {group}")


def material_for(key):
    if key == "bojo":
        return "madeira"
    if key == "couro":
        return "couro"
    return "aco"


# ---------------------------------------------------------------- parse OBJ
def parse_obj():
    v, vt, vn = [], [], []
    groups = {}  # nome -> lista de faces [(vi, ti, ni) x3]
    order = []
    cur = None
    for line in OBJ.read_text(encoding="utf-8").splitlines():
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("vn "):
            vn.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("g "):
            cur = line[2:].strip()
            if cur not in groups:
                groups[cur] = []
                order.append(cur)
        elif line.startswith("f "):
            idx = []
            for tok in line.split()[1:]:
                a = tok.split("/")
                idx.append((int(a[0]) - 1, int(a[1]) - 1, int(a[2]) - 1))
            for i in range(1, len(idx) - 1):  # triangula leques
                groups[cur].append((idx[0], idx[i], idx[i + 1]))
    return np.array(v), np.array(vt), np.array(vn), groups, order


def build_mesh(faces, V, VT, VN, uv_scale):
    lookup, pos, nor, uv, ind = {}, [], [], [], []
    for tri in faces:
        for key in tri:
            n = lookup.get(key)
            if n is None:
                n = len(pos)
                lookup[key] = n
                pos.append(V[key[0]] * SCALE)
                uv.append(VT[key[1]] * uv_scale)
                nor.append(VN[key[2]])
            ind.append(n)
    pos = np.array(pos, dtype="<f4")
    nor = np.array(nor, dtype="<f4")
    uv = np.array(uv, dtype="<f4")
    uv[:, 1] = 1.0 - uv[:, 1]  # glTF tem a origem de V no topo
    return pos, nor, uv, np.array(ind, dtype="<u4")


# ---------------------------------------------------------------- textura de madeira
def periodic_noise(size, rng, exponent, stretch):
    """Ruído contínuo (ladrilhável) filtrado em frequência; stretch>1 alonga a veia no eixo u."""
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    radius = np.sqrt((fx / stretch) ** 2 + fy ** 2)
    radius[0, 0] = 1.0
    spectrum = (rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))) / radius ** exponent
    spectrum[0, 0] = 0
    n = np.fft.ifft2(spectrum).real
    return (n - n.min()) / (n.max() - n.min())


def wood_texture(size=512):
    rng = np.random.default_rng(7)
    warp = periodic_noise(size, rng, 2.2, 1.0)
    fine = periodic_noise(size, rng, 1.2, 8.0)
    v = np.linspace(0, 1, size, endpoint=False)[:, None] * np.ones((1, size))
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * (14 * v + 0.9 * warp))
    tone = 0.4 * rings + 0.6 * fine
    tone = (tone - tone.mean()) / (tone.std() * 8)  # variação suave em torno de 0
    base = np.array(KD_WOOD)
    dark = base * 0.62
    light = np.minimum(base * 1.18, 1.0)
    t = np.clip(0.5 + tone, 0, 1)[..., None]
    rgb = dark * (1 - t) + light * t
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype("uint8"), "RGB")
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- GLB
def main():
    V, VT, VN, groups, order = parse_obj()

    meshes_in = []  # (key, group, material)
    n_orelha = 0
    for g in order:
        k = node_key(g)
        if k is None:
            n_orelha += 1
            k = f"orelha_{n_orelha}"
        meshes_in.append((k, g, material_for(k)))

    # esticadores em ordem numérica estável
    meshes_in.sort(key=lambda t: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", t[0])])

    chunks = bytearray()
    buffer_views, accessors, meshes, nodes = [], [], [], []

    def add_view(data, target=None):
        while len(chunks) % 4:
            chunks.append(0)
        start = len(chunks)
        chunks.extend(data)
        view = {"buffer": 0, "byteOffset": start, "byteLength": len(data)}
        if target:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    def add_accessor(view, ctype, count, atype, mn=None, mx=None):
        acc = {"bufferView": view, "componentType": ctype, "count": count, "type": atype}
        if mn is not None:
            acc["min"], acc["max"] = mn, mx
        accessors.append(acc)
        return len(accessors) - 1

    mat_index = {"madeira": 0, "aco": 1, "couro": 2}
    for key, g, mat in meshes_in:
        uv_scale = 1.0 / WOOD_TILE_CM if mat == "madeira" else 1.0
        pos, nor, uv, ind = build_mesh(groups[g], V, VT, VN, uv_scale)
        a_pos = add_accessor(add_view(pos.tobytes(), 34962), 5126, len(pos), "VEC3",
                             pos.min(0).tolist(), pos.max(0).tolist())
        a_nor = add_accessor(add_view(nor.tobytes(), 34962), 5126, len(nor), "VEC3")
        attrs = {"POSITION": a_pos, "NORMAL": a_nor}
        if mat == "madeira":
            attrs["TEXCOORD_0"] = add_accessor(add_view(uv.tobytes(), 34962), 5126, len(uv), "VEC2")
        a_ind = add_accessor(add_view(ind.tobytes(), 34963), 5125, len(ind), "SCALAR")
        meshes.append({"name": key, "primitives": [{"attributes": attrs, "indices": a_ind,
                                                    "material": mat_index[mat]}]})
        nodes.append({"name": key, "mesh": len(meshes) - 1})

    img_view = add_view(wood_texture())

    gltf = {
        "asset": {"version": "2.0", "generator": "engome-convert-obj"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [
            {"name": "Nogueira", "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.78}},
            {"name": "Aço acetinado", "pbrMetallicRoughness": {
                "baseColorFactor": [*srgb_to_linear(KD_STEEL).tolist(), 1],
                "metallicFactor": 0.85, "roughnessFactor": 0.38}},
            {"name": "Couro envelhecido", "doubleSided": True, "pbrMetallicRoughness": {
                "baseColorFactor": [*srgb_to_linear(KD_LEATHER).tolist(), 1],
                "metallicFactor": 0.0, "roughnessFactor": 0.7}},
        ],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "images": [{"bufferView": img_view, "mimeType": "image/png"}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "buffers": [{"byteLength": len(chunks)}],
    }

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(chunks) % 4:
        chunks.append(0)
    total = 12 + 8 + len(js) + 8 + len(chunks)
    OUT.write_bytes(
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(js), 0x4E4F534A) + js
        + struct.pack("<II", len(chunks), 0x004E4942) + bytes(chunks)
    )

    # metadados das peças (mesma estrutura de antes; sem suportes/aba, que não existem no OBJ)
    old = json.loads(PARTS_OUT.read_text(encoding="utf-8"))
    parts = {}
    for key, _, _ in meshes_in:
        if key in old:
            parts[key] = old[key]
        elif key == "couro":
            parts[key] = {"key": "couro", "label": "Couro (pele do tambor)", "group": "couro", "material": None}
    PARTS_OUT.write_text(json.dumps(parts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e6:.1f} MB, {len(nodes)} peças")


if __name__ == "__main__":
    main()
