from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parents[1]
build_dir = root / 'build'
build_dir.mkdir(exist_ok=True)

size = 1024
canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow)
shadow_draw.rounded_rectangle((108, 108, 916, 916), radius=232, fill=(63, 38, 18, 100))
shadow = shadow.filter(ImageFilter.GaussianBlur(48))
canvas.alpha_composite(shadow, (0, 18))

def vertical_gradient(top, bottom):
    gradient = Image.new('RGBA', (1, size), color=0)
    pixels = []
    for y in range(size):
        ratio = y / (size - 1)
        pixels.append(tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(4)))
    gradient.putdata(pixels)
    return gradient.resize((size, size))

bg = vertical_gradient((92, 58, 28, 255), (48, 30, 14, 255))
mask = Image.new('L', (size, size), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle((120, 120, 904, 904), radius=220, fill=255)
canvas.alpha_composite(Image.composite(bg, Image.new('RGBA', (size, size), (0, 0, 0, 0)), mask))

glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((170, 150, 880, 720), fill=(245, 209, 138, 62))
glow = glow.filter(ImageFilter.GaussianBlur(48))
canvas.alpha_composite(glow)

draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((208, 196, 816, 812), radius=180, outline=(255, 228, 180, 40), width=4)

page_shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
page_shadow_draw = ImageDraw.Draw(page_shadow)
page_shadow_draw.rounded_rectangle((238, 258, 790, 742), radius=96, fill=(44, 25, 10, 68))
page_shadow = page_shadow.filter(ImageFilter.GaussianBlur(28))
canvas.alpha_composite(page_shadow, (0, 16))

left_page = [(248, 270), (470, 238), (506, 700), (282, 736)]
right_page = [(556, 246), (776, 282), (742, 736), (520, 700)]
page_highlight = (255, 246, 225, 255)
page_warm = (250, 232, 194, 255)

draw.polygon(left_page, fill=page_highlight)
draw.polygon(right_page, fill=page_warm)
draw.line((512, 250, 514, 706), fill=(191, 152, 97, 180), width=10)
draw.line((474, 322, 328, 346), fill=(201, 166, 116, 122), width=9)
draw.line((474, 402, 334, 424), fill=(201, 166, 116, 122), width=9)
draw.line((474, 482, 340, 502), fill=(201, 166, 116, 122), width=9)
draw.line((550, 342, 696, 364), fill=(194, 152, 97, 112), width=9)
draw.line((548, 422, 690, 446), fill=(194, 152, 97, 112), width=9)
draw.line((544, 502, 684, 526), fill=(194, 152, 97, 112), width=9)

quill = Image.new('RGBA', (size, size), (0, 0, 0, 0))
quill_draw = ImageDraw.Draw(quill)
quill_draw.polygon([(626, 188), (748, 312), (610, 458), (548, 394)], fill=(253, 214, 133, 255))
quill_draw.polygon([(584, 428), (756, 258), (820, 322), (648, 494)], fill=(193, 137, 70, 255))
quill_draw.polygon([(784, 286), (858, 210), (884, 236), (808, 312)], fill=(255, 239, 198, 255))
quill_draw.line((598, 446, 834, 224), fill=(113, 67, 30, 230), width=20)
quill = quill.filter(ImageFilter.GaussianBlur(0.4))
canvas.alpha_composite(quill)

draw.ellipse((730, 168, 780, 218), fill=(255, 233, 185, 230))
draw.ellipse((756, 138, 776, 158), fill=(255, 247, 223, 200))

aura = Image.new('RGBA', (size, size), (0, 0, 0, 0))
aura_draw = ImageDraw.Draw(aura)
aura_draw.rounded_rectangle((120, 120, 904, 904), radius=220, outline=(255, 246, 224, 44), width=12)
aura = aura.filter(ImageFilter.GaussianBlur(6))
canvas.alpha_composite(aura)

icon_png = build_dir / 'icon.png'
icon_ico = build_dir / 'icon.ico'
installer_ico = build_dir / 'installerIcon.ico'
uninstaller_ico = build_dir / 'uninstallerIcon.ico'

canvas.save(icon_png)
canvas.save(icon_ico, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
canvas.save(installer_ico, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
canvas.save(uninstaller_ico, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(icon_png)
print(icon_ico)
