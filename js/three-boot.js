// Three.js(모듈)를 불러와 나머지 일반 스크립트가 쓸 수 있게 window에 걸어 둔다
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
window.THREE = THREE;
window.THREE_ADDONS = { GLTFLoader, mergeGeometries };
window.dispatchEvent(new Event('three-ready'));
