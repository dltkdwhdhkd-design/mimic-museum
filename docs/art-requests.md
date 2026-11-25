# 그림 교체 안내 (ChatGPT 등으로 뽑아 넣기)

지금 그림은 전부 코드가 즉석에서 그린다. 아래 이름으로 PNG를 만들어 주면 `img/`에 넣고 `js/art.js`의 `PROVIDED` 목록에 이름을 적어 바꾼다. 파일이 없거나 목록에 없으면 기본 그림이 나온다. 그림은 세로 높이가 게임 안에서 정해져 있어서, **가로·세로 비율을 아래와 맞춰야** 바닥 차지 넓이와 그림이 어긋나지 않는다.

**전시물 606개는 바꾸지 않는다.** 진짜 물건과 멈춰 있는 미믹이 같은 그림 함수로 그려져야 구별이 안 되는데, 전시물마다 그림을 받으면 화풍이 섞이고 양도 너무 많다. 전시물은 Twemoji와 코드 그림(암석·광물·행성·별·분자·세포 등) 그대로 둔다. 효과가 큰 순서는 학예사 → 가구(미믹이 잡동사니로 변신하는 화분·휴지통·소화기·긴 의자·안내판) → 받침대.

**눈알은 그리지 않는다.** 움직이는 미믹의 눈알과 '진짜' 도장은 게임이 그림 위에 덧그린다. 가구 그림에 얼굴이 있으면 진짜 가구도 얼굴이 있게 되어 숨바꼭질이 깨진다.

## 공통 앞부분
아래 문단을 그대로 붙이고 끝에 물건 설명만 바꾼다.
> Single game sprite for a bright, friendly first-person hide-and-seek game set in a science museum at night. Clean cel-shaded cartoon style with soft gradients, warm museum lighting from the front, gentle navy and brass accents. Straight front view at eye level, the whole subject visible and centered, its base touching the bottom edge of the image. Isolated on a fully transparent background, no floor, no wall, no cast shadow, no text, no labels. The subject: ...

## 학예사 (찾는 팀 캐릭터, 가장 효과 큼)
- 파일: `img/curator1.png`(1팀 빨강) `img/curator2.png`(2팀 파랑) `img/curator3.png`(3팀 초록) `img/curator4.png`(4팀 노랑). 한 장만 만들려면 `img/curator.png` 하나만 — 그러면 게임이 발밑에 팀 색 띠를 붙인다.
- 규격: 가로 1 : 세로 2.1 (예: 400×840). 발바닥이 그림 맨 아래에 닿게. 감옥에 갇힌 모습은 게임이 어둡게 처리한다.
- 물건 설명:
  > a cheerful middle-school student working as a night museum curator, full body, standing straight and facing the viewer, white curator's coat over a team-colored vest (red / blue / green / yellow for each version), holding a big brass magnifying glass in the right hand and a rubber stamp in the left, short neat hair, sneakers. Same character design for all four versions, only the vest color changes.

## 받침대
- 파일: `img/pedestal.png`
- 규격: 가로 8 : 세로 7 (예: 480×420). **받침대 윗면이 그림 맨 위에, 바닥이 맨 아래에** 닿게(위에 놓인 전시물은 게임이 따로 얹는다). 앞면 가운데에 작은 황동 이름판.
- 물건 설명:
  > a museum display plinth, ivory marble column with a slightly wider top slab and a dark base, small blank brass nameplate on the front, the top surface flat and empty.

## 가구
모두 공통 앞부분을 쓰고 끝의 설명만 바꾼다. 위의 다섯(`plant`·`trash`·`extinguisher`·`bench`·`poster`)은 미믹이 변신하는 잡동사니이기도 해서 자주 보인다.

| 파일 | 비율 (가로:세로) | 물건 설명 |
|---|---|---|
| `bench` | 2 : 1 | a wooden museum bench with dark metal legs, seen from the front |
| `plant` | 1 : 1.7 | a tall leafy potted plant in a terracotta pot |
| `desk` | 1.75 : 1 | a navy museum information desk with a small "information" sign shape (no letters) |
| `vending` | 1 : 1.85 | a red drink vending machine with a lit glass front full of colorful cans |
| `rope` | 1.7 : 1 | two brass stanchion posts joined by a sagging red velvet rope |
| `trash` | 1 : 1.3 | a dark green metal museum trash bin with a lid and a small recycling label (no text) |
| `extinguisher` | 1 : 2 | a red fire extinguisher standing on the floor, black hose and handle, white label without text |
| `poster` | 1 : 1.4 | a standing exhibition sign board on a single pole, blank poster with simple shapes, no text |

## 넣는 법
1. 위 이름 그대로 `img/`에 올린다.
2. `js/art.js` 위쪽의 `const PROVIDED = [];`에 이름을 적는다. 예: `const PROVIDED = ["curator1", "curator2", "curator3", "curator4", "pedestal"];`
3. 새로고침해서 확인한다. 바로 안 바뀌면 `index.html`의 `?v=` 숫자를 바꿔 캐시를 지운다.

그림만 보내 주면 넣는 것은 Claude가 해도 된다.
