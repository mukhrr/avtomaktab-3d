"""Mean luma (Rec. 709 weights on 0-255 sRGB values) of screenshot regions.

usage: python3 tools/visual/luminance.py IMAGE name=x0,y0,x1,y1 [name=...]
Needs Pillow.
"""
import sys

from PIL import Image, ImageStat

WEIGHTS = (0.2126, 0.7152, 0.0722)


def mean_luma(img, box):
    means = ImageStat.Stat(img.convert('RGB').crop(box)).mean
    return sum(w * c for w, c in zip(WEIGHTS, means))


def main(argv):
    img = Image.open(argv[1])
    for arg in argv[2:]:
        name, box = arg.split('=')
        print(f'{name}\t{mean_luma(img, tuple(int(v) for v in box.split(","))):.1f}')


if __name__ == '__main__':
    main(sys.argv)
