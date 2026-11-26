"""모든 모델을 다시 만든다:  python3 tools/blender/build.py
결과: assets/models/museum.glb (게임용), blend/museum.blend (블렌더에서 열어 고치는 원본)
처음 한 번: pip install bpy   (블렌더를 파이썬 모듈로 설치)"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import lib
import museum

if __name__ == '__main__':
    lib.reset()
    museum.build()
    lib.export(os.path.join(ROOT, 'assets/models/museum.glb'), os.path.join(ROOT, 'blend/museum.blend'), spacing=2.0, cols=6)
