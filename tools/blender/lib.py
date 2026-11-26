"""미믹 뮤지엄 — 블렌더 모델 제작용 공통 도구 (도토리 마을의 lib.py를 가져와 색표만 바꿈).

모든 모델은 이 파일의 함수로 '코드에서' 만든다. (블렌더 5.x, bpy 모듈)
- 단위: 1 = 타일 한 칸.  Z가 위, 정면은 -Y (glTF로 내보내면 +Z가 정면)
- 모델 하나 = 이름 붙은 루트. 움직여야 하는 부위는 Part로 나눈다(이름: 모델__부위).
- 재질은 색만 쓴다(텍스처 없음). 게임이 재질 '이름'을 보고 계절 색 등을 바꾼다.
"""
import math
import os
import bpy
import bmesh
from mathutils import Matrix, Vector, Euler, noise

# ----------------------------------------------------------------- 재질
PALETTE = {
    # 받침대·전시
    'marble': '#ece6da', 'marble_d': '#d3cbbd', 'marble_v': '#bfb6a6', 'brass': '#c9a24a', 'brass_d': '#9c7a30', 'ink': '#3a3226', 'felt': '#7a2e3a',
    # 가구
    'wood': '#b47c4a', 'wood_d': '#8a5a32', 'wood_l': '#d09a62', 'metal': '#4a4f58', 'metal_l': '#8a919c', 'chrome': '#c9ced6',
    'terracotta': '#c96a3f', 'terracotta_d': '#a5532f', 'soil': '#4e3626', 'leaf': '#4f9a52', 'leaf_d': '#3c7d43', 'leaf_l': '#74c165',
    'bin': '#4f6b5a', 'bin_d': '#3a4d41', 'bin_l': '#6f9079', 'red': '#d9372c', 'red_d': '#a82820', 'black': '#24252a', 'white': '#f4f2ec',
    'navy': '#1f2b44', 'navy_l': '#33476e', 'gold': '#d9b45a', 'glass': '#a9d8ec', 'screen': '#fff4c8', 'velvet': '#a3192b', 'velvet_d': '#7e1220',
    'can1': '#e8574c', 'can2': '#4a8fe2', 'can3': '#46b16a', 'can4': '#f0c24a', 'can5': '#9a6bd0', 'paper': '#f6f0de', 'sky': '#7ec3e6',
    # 학예사 (team 재질은 게임이 팀 색으로 바꾼다)
    'skin': '#ffd9bf', 'cheek': '#f6a8a0', 'hair': '#4a3426', 'hair_l': '#5e4332', 'eye': '#2a2020', 'coat': '#f3f1ea', 'coat_d': '#d9d5c8',
    'pants': '#3a4152', 'shoe': '#2b2b30', 'team': '#e2574c', 'team_d': '#b8443a',
    # 도장총
    'gun': '#5a6070', 'gun_d': '#3d424e', 'ink_red': '#d32f2f', 'rubber': '#b71c1c',
}
_mats = {}


def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip('#')
    return tuple(srgb2lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def get_mat(name):
    """이름으로 재질을 얻는다. '#rrggbb'를 주면 그 색의 재질(이름 c_rrggbb)을 만든다."""
    if isinstance(name, (tuple, list)):    # (r, g, b) 0~255
        name = '#%02x%02x%02x' % tuple(int(max(0, min(255, v))) for v in name[:3])
    if name in _mats:                      # 그림을 입힌 재질 등, 미리 등록해 둔 것
        return _mats[name]
    if name.startswith('#'):
        key, col = 'c_' + name[1:].lower(), name
    else:
        key, col = name, PALETTE[name]
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = hexlin(col)
    bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = hexlin(col)
    _mats[key] = m
    return m


# ----------------------------------------------------------------- 변환 도우미
def TRS(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    r = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
    return Matrix.Translation(Vector(loc)) @ r @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))


# ----------------------------------------------------------------- 모델/부위
_current = []          # 현재 열려 있는 Part 스택
MODELS = []            # 만들어진 모델 루트 목록(순서대로)


class Part:
    """모델의 한 부위. 여기에 도형을 계속 더한 뒤 메시 하나로 만든다."""

    def __init__(self, name, pivot=(0, 0, 0), parent=None):
        self.name = name
        self.pivot = Vector(pivot)
        self.parent = parent
        self.bm = bmesh.new()
        self.mats = []
        self.sharp = 50.0

    def mi(self, mat):
        m = get_mat(mat)
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def __enter__(self):
        _current.append(self)
        return self

    def __exit__(self, *a):
        _current.pop()

    def build(self, objname):
        bm = self.bm
        if self.pivot.length > 0:
            bmesh.ops.translate(bm, verts=bm.verts, vec=-self.pivot)
        bm.normal_update()
        ang = math.radians(self.sharp)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                if not (e.link_faces[0].smooth and e.link_faces[1].smooth) or e.calc_face_angle(0) > ang:
                    e.smooth = False
        me = bpy.data.meshes.new(objname)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(objname, me)
        ob.location = self.pivot
        bpy.context.scene.collection.objects.link(ob)
        return ob


class Model:
    """with Model('이름'): 안에서 도형을 만들면 그 모델에 들어간다."""

    def __init__(self, name):
        self.name = name
        self.main = Part(name)
        self.parts = []
        self.anchors = []

    def __enter__(self):
        global _model
        _model = self
        _current.append(self.main)
        return self

    def part(self, name, pivot=(0, 0, 0), parent=None):
        """움직이는 부위를 만든다. parent에 다른 부위 이름을 주면 그 부위에 딸려 움직인다(예: 머리에 붙은 눈)."""
        p = Part(name, pivot, parent)
        self.parts.append(p)
        return p

    def anchor(self, name, loc, parent=None):
        self.anchors.append((name, Vector(loc), parent))

    def __exit__(self, *a):
        _current.pop()
        has_main = len(self.main.bm.verts) > 0
        if not self.parts and not self.anchors:
            root = self.main.build(self.name)
        else:
            root = bpy.data.objects.new(self.name, None)
            root.empty_display_size = 0.2
            bpy.context.scene.collection.objects.link(root)
            if has_main:
                ob = self.main.build(self.name + '__main')
                ob.parent = root
            built = {}
            for p in self.parts:
                ob = p.build(self.name + '__' + p.name)
                ob.parent = root
                built[p.name] = ob
            for p in self.parts:
                if p.parent and p.parent in built:
                    ob = built[p.name]
                    ob.parent = built[p.parent]
                    ob.location = p.pivot - next(q.pivot for q in self.parts if q.name == p.parent)
            for (nm, loc, parent) in self.anchors:
                e = bpy.data.objects.new(self.name + '__' + nm, None)
                e.empty_display_size = 0.08
                bpy.context.scene.collection.objects.link(e)
                if parent and parent in built:
                    e.parent = built[parent]
                    e.location = loc - next(q.pivot for q in self.parts if q.name == parent)
                else:
                    e.parent = root
                    e.location = loc
        MODELS.append(root)


def cur():
    return _current[-1]


_proj = [None]


def set_proj(fn):
    """그림을 입히는 방법을 정한다. fn(꼭짓점 위치) → (u, v). None이면 끈다.
    켜 둔 동안 만드는 모든 도형에, 그 위치를 그림 위의 한 점으로 비춰 텍스처 좌표를 준다(평면 투영)."""
    _proj[0] = fn


def _finish(new_verts, mat, smooth):
    p = cur()
    idx = p.mi(mat)
    faces = set()
    for v in new_verts:
        for f in v.link_faces:
            faces.add(f)
    for f in faces:
        f.material_index = idx
        f.smooth = smooth
    if _proj[0]:
        uv = p.bm.loops.layers.uv.verify()
        fn = _proj[0]
        for f in faces:
            for l in f.loops:
                l[uv].uv = fn(l.vert.co)
    return list(faces)


def xform(faces, M):
    """이미 만든 면들의 꼭짓점을 행렬 M으로 옮긴다(그림 좌표는 그대로 둔 채 모양만 기울이거나 옮길 때)."""
    vs = set()
    for f in faces:
        for v in f.verts:
            vs.add(v)
    for v in vs:
        v.co = M @ v.co


def rot_about(faces, pivot, axis, deg):
    """면들을 pivot을 지나는 축(axis 'X'|'Y'|'Z' 또는 벡터)으로 deg도 돌린다."""
    pv = Vector(pivot)
    R = Matrix.Rotation(math.radians(deg), 4, axis)
    xform(faces, Matrix.Translation(pv) @ R @ Matrix.Translation(-pv))


# ----------------------------------------------------------------- 도형
def ball(loc, r, mat, scale=(1, 1, 1), rot=(0, 0, 0), sub=2, smooth=True):
    """정이십면체 구. r=반지름, scale로 찌그러뜨린다."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    M = TRS(loc, rot, (r * scale[0], r * scale[1], r * scale[2]))
    res = bmesh.ops.create_icosphere(cur().bm, subdivisions=sub, radius=1.0, matrix=M)
    return _finish(res['verts'], mat, smooth)


def uvball(loc, r, mat, scale=(1, 1, 1), rot=(0, 0, 0), seg=12, rings=8, smooth=True):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    M = TRS(loc, rot, (r * scale[0], r * scale[1], r * scale[2]))
    res = bmesh.ops.create_uvsphere(cur().bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=M)
    return _finish(res['verts'], mat, smooth)


def cyl(base, r, h, mat, r2=None, seg=12, rot=(0, 0, 0), smooth=True, caps=True, scale=(1, 1, 1)):
    """원기둥/원뿔대. base=밑면 중심, r=밑 반지름, r2=윗 반지름(없으면 r), h=높이. rot은 밑면 중심 기준."""
    if r2 is None:
        r2 = r
    M = TRS(base, rot, scale) @ Matrix.Translation((0, 0, h / 2))
    res = bmesh.ops.create_cone(cur().bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=max(r2, 1e-4),
                                depth=h, matrix=M)
    return _finish(res['verts'], mat, smooth)


def cone(base, r, h, mat, seg=12, rot=(0, 0, 0), smooth=True, scale=(1, 1, 1)):
    return cyl(base, r, h, mat, r2=0.0, seg=seg, rot=rot, smooth=smooth, scale=scale)


def box(center, size, mat, rot=(0, 0, 0), bevel=0.0, seg=1):
    """상자. center=중심, size=(x,y,z) 크기. bevel>0이면 모서리를 둥글린다."""
    M = TRS(center, rot, size)
    bm = cur().bm
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    verts = res['verts']
    if bevel > 0:
        edges = set()
        for v in verts:
            for e in v.link_edges:
                edges.add(e)
        r2 = bmesh.ops.bevel(bm, geom=list(edges), offset=bevel, segments=seg, affect='EDGES', profile=0.5)
        verts = r2['verts']
        return _finish(verts, mat, True)
    return _finish(verts, mat, False)


def boxb(base, size, mat, rot=(0, 0, 0), bevel=0.0, seg=1):
    """밑면 중심을 기준으로 놓는 상자."""
    M = TRS(base, rot, (1, 1, 1)) @ Matrix.Translation((0, 0, size[2] / 2))
    c = M.to_translation()
    return box(tuple(c), size, mat, rot, bevel, seg)


def poly(verts, faces, mat, smooth=False):
    """직접 꼭짓점과 면을 줘서 만든다."""
    bm = cur().bm
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm.normal_update()
    return _finish(vs, mat, smooth)


def register_mat(name, material):
    """이미 만든 블렌더 재질(그림 재질 등)을 이름으로 쓸 수 있게 등록한다."""
    _mats[name] = material


def mesh_uv(verts, faces, mat, uvs, smooth=True):
    """꼭짓점·면·텍스처 좌표를 직접 줘서 만든다(그림을 입히는 모델용). uvs는 꼭짓점마다 (u, v)."""
    bm = cur().bm
    layer = bm.loops.layers.uv.verify()
    vs = [bm.verts.new(v) for v in verts]
    made = []
    for f in faces:
        try:
            face = bm.faces.new([vs[i] for i in f])
        except ValueError:
            continue
        for loop, i in zip(face.loops, f):
            loop[layer].uv = uvs[i]
        made.append(face)
    bm.normal_update()
    idx = cur().mi(mat)
    for f in made:
        f.material_index = idx
        f.smooth = smooth
    return made


def fix_normals(faces):
    """면들의 앞뒤를 바깥쪽으로 맞춘다(닫힌 덩어리용)."""
    bmesh.ops.recalc_face_normals(cur().bm, faces=faces)


def prism(base, w, d, h, mat, rot=(0, 0, 0), over=0.0):
    """박공지붕 모양 삼각기둥. 용마루가 X축 방향. base=밑면 중심."""
    x, y = w / 2 + over, d / 2 + over
    V = [(-x, -y, 0), (x, -y, 0), (x, y, 0), (-x, y, 0), (-x, 0, h), (x, 0, h)]
    M = TRS(base, rot)
    V = [tuple(M @ Vector(v)) for v in V]
    F = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    return poly(V, F, mat)


def disc(center, r, mat, seg=14, rot=(0, 0, 0), scale=(1, 1, 1)):
    M = TRS(center, rot, scale)
    res = bmesh.ops.create_circle(cur().bm, cap_ends=True, cap_tris=False, segments=seg, radius=r, matrix=M)
    return _finish(res['verts'], mat, False)


def torus(center, R, r, mat, seg=14, tseg=6, rot=(0, 0, 0), scale=(1, 1, 1)):
    M = TRS(center, rot, scale)
    V, F = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(tseg):
            b = 2 * math.pi * j / tseg
            V.append(tuple(M @ Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))))
    for i in range(seg):
        for j in range(tseg):
            a, b = i * tseg + j, i * tseg + (j + 1) % tseg
            c, d = ((i + 1) % seg) * tseg + (j + 1) % tseg, ((i + 1) % seg) * tseg + j
            F.append((a, d, c, b))
    return poly(V, F, mat, smooth=True)


def lathe(profile, mat, center=(0, 0, 0), seg=16, scale=(1, 1), rot=(0, 0, 0), smooth=True, caps=True):
    """회전체. profile=[(반지름, 높이), ...]를 아래에서 위로 적는다. 반지름 0이면 꼭짓점으로 모인다.
    scale=(x, y)로 단면을 타원으로 만든다. 옷 입은 몸통, 모자, 항아리, 둥근 지붕 등에 쓴다."""
    M = TRS(center, rot, (scale[0], scale[1], 1))
    bm = cur().bm
    rings = []
    for (r, z) in profile:
        if r <= 1e-5:
            rings.append([bm.verts.new(tuple(M @ Vector((0, 0, z))))])
        else:
            rings.append([bm.verts.new(tuple(M @ Vector((r * math.cos(2 * math.pi * j / seg), r * math.sin(2 * math.pi * j / seg), z)))) for j in range(seg)])
    faces = []
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(seg):
            k = (j + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                vs = [a[0], b[k], b[j]]
            elif len(b) == 1:
                vs = [a[j], a[k], b[0]]
            else:
                vs = [a[j], a[k], b[k], b[j]]
            try:
                faces.append(bm.faces.new(vs))
            except ValueError:
                pass
    if caps:
        if len(rings[0]) > 1:
            faces.append(bm.faces.new(list(reversed(rings[0]))))
        if len(rings[-1]) > 1:
            faces.append(bm.faces.new(rings[-1]))
    bm.normal_update()
    allv = [v for r in rings for v in r]
    return _finish(allv, mat, smooth)


def dome(center, r, mat, scale=(1, 1, 1), rot=(0, 0, 0), seg=16, rings=6, cut=0.5, smooth=True, aim=(0, 0, 0)):
    """구의 윗부분만(머리카락, 모자 등). cut=0.5면 반구, 0.7이면 조금 더 아래까지 덮는다.
    aim=(x,y,z)도: 찌그러뜨리기(scale) '전에' 돌린다 — 타원 머리의 한쪽을 딱 맞게 덮을 때 쓴다."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    prof = []
    for i in range(rings + 1):
        a = math.pi * cut * (1 - i / rings)          # 아래(자른 곳)에서 꼭대기로
        prof.append((r * math.sin(a), r * math.cos(a)))
    M = TRS(center, rot, scale) @ Euler([math.radians(a) for a in aim], 'XYZ').to_matrix().to_4x4()
    bm = cur().bm
    rs = []
    for (rr, z) in prof:
        if rr <= 1e-5:
            rs.append([bm.verts.new(tuple(M @ Vector((0, 0, z))))])
        else:
            rs.append([bm.verts.new(tuple(M @ Vector((rr * math.cos(2 * math.pi * j / seg), rr * math.sin(2 * math.pi * j / seg), z)))) for j in range(seg)])
    for a, b in zip(rs[:-1], rs[1:]):
        for j in range(seg):
            k = (j + 1) % seg
            vs = [a[j], a[k], b[0]] if len(b) == 1 else [a[j], a[k], b[k], b[j]]
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
    bm.normal_update()
    return _finish([v for q in rs for v in q], mat, smooth)


def arc(center, R, r, mat, a0=0, a1=180, seg=10, tseg=6, rot=(0, 0, 0), scale=(1, 1, 1)):
    """고리의 일부(웃는 입, 눈썹, 손잡이 등). XY 평면에 a0~a1도 만큼 그린다."""
    M = TRS(center, rot, scale)
    V, F = [], []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        for j in range(tseg):
            b = 2 * math.pi * j / tseg
            V.append(tuple(M @ Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))))
    for i in range(seg):
        for j in range(tseg):
            a, b = i * tseg + j, i * tseg + (j + 1) % tseg
            c, d = (i + 1) * tseg + (j + 1) % tseg, (i + 1) * tseg + j
            F.append((a, d, c, b))
    n = len(V)
    V.append(tuple(M @ Vector((R * math.cos(math.radians(a0)), R * math.sin(math.radians(a0)), 0))))
    V.append(tuple(M @ Vector((R * math.cos(math.radians(a1)), R * math.sin(math.radians(a1)), 0))))
    for j in range(tseg):
        F.append((n, j, (j + 1) % tseg))
        F.append((n + 1, seg * tseg + (j + 1) % tseg, seg * tseg + j))
    return poly(V, F, mat, smooth=True)


def lump(loc, r, mat, scale=(1, 1, 1), seed=0, amp=0.18, sub=2, smooth=False, rot=(0, 0, 0)):
    """울퉁불퉁한 덩어리(돌 등)."""
    faces = ball(loc, r, mat, scale, rot, sub, smooth)
    vs = set()
    for f in faces:
        for v in f.verts:
            vs.add(v)
    c = Vector(loc)
    for v in vs:
        d = v.co - c
        n = noise.noise(d * (1.7 / max(r, 1e-3)) + Vector((seed * 3.1, seed * 1.7, seed * 0.9)))
        v.co = c + d * (1.0 + n * amp)
    return faces


def tube(p0, p1, r, mat, r2=None, seg=8, smooth=True):
    """두 점을 잇는 원기둥(가지, 다리 등)."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    h = d.length
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    M = Matrix.Translation(a) @ q.to_matrix().to_4x4() @ Matrix.Translation((0, 0, h / 2))
    res = bmesh.ops.create_cone(cur().bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                                radius2=max(r if r2 is None else r2, 1e-4), depth=h, matrix=M)
    return _finish(res['verts'], mat, smooth)


def capsule(p0, p1, r, mat, seg=8, sub=2):
    tube(p0, p1, r, mat, seg=seg)
    ball(p0, r, mat, sub=sub)
    ball(p1, r, mat, sub=sub)


# ----------------------------------------------------------------- 저장/내보내기
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    MODELS.clear()


def layout_grid(spacing=4.0, cols=8):
    """블렌더에서 열어 보기 좋게 모델을 바둑판으로 늘어놓는다."""
    for i, root in enumerate(MODELS):
        root.location = Vector(((i % cols) * spacing, -(i // cols) * spacing, 0))


def export(glb_path, blend_path=None, spacing=4.0, cols=8, webp=False):
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    _proj[0] = None
    extra = dict(export_image_format='WEBP', export_image_quality=92) if webp else {}
    for root in MODELS:
        root.location = Vector((0, 0, 0))
    bpy.ops.object.select_all(action='DESELECT')
    for ob in bpy.context.scene.collection.all_objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=False, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False,
                              export_animations=False, export_extras=False, **extra)
    if blend_path:
        os.makedirs(os.path.dirname(blend_path), exist_ok=True)
        layout_grid(spacing, cols)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend_path), compress=True)
    n = len(MODELS)
    print('  -> %s (%d개 모델, %.0f KB)' % (os.path.basename(glb_path), n, os.path.getsize(glb_path) / 1024))
