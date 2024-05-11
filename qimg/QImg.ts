import { ImageData, createImageData } from 'canvas'
import {
    Color,
    CompressedImage,
    ImageCompressionAlgorithm,
    Position,
} from '../index'
import splitIntoBoxes, { Box, ImageBoxes, UncompressedBox } from '../utils/splitIntoBoxes.js'
import getLuminance from '../utils/getLuminance'
import getBoxColors from '../utils/getBoxColors'

type IndexedPixel = Position & {
    index: number,
}

type CompressedBox = Box & {
    light: Color,
    dark: Color,
    data: IndexedPixel[],
}

type QImgCompressionOptions = {
    boxSize: number,
}

export class QImg implements ImageCompressionAlgorithm {
    static MAGIC = [99, 115, 113, 47, 113, 105, 109, 103] // csq/qimg

    #compressBoxes(boxes: ImageBoxes<UncompressedBox>): ImageBoxes<CompressedBox> {
        // for every box...
        const compressedBoxes: CompressedBox[] = boxes.data.map(box => {
            const {x, y, size, data} = box

            // get the average luminance, then the average colors of
            // all pixels above the average luminance, and all pixels
            // below the average luminance
            const {
                averageLuminance,
                light,
                dark,
            } = getBoxColors(box)

            // convert all pixels to use index instead of full color
            // 1 = light pixel (use average light color)
            // 0 = dark pixel (use average dark color)
            const indexedPixels: IndexedPixel[] = data.map(({x, y, color}) => {
                const luminance = getLuminance(color)
                const index = luminance >= averageLuminance ? 1 : 0

                return {
                    x,
                    y,
                    index,
                }
            })

            return {
                x,
                y,
                size,
                light,
                dark,
                data: indexedPixels,
            }
        })

        return {
            size: boxes.size,
            data: compressedBoxes,
        }
    }

    compress(image: ImageData, { boxSize }: QImgCompressionOptions) {
        if (!boxSize) throw new Error('no argument provided for qimg option "boxSize"')

        const boxes = splitIntoBoxes(image, boxSize)
        const compressed = this.#compressBoxes(boxes)
        
        return new QImgCompressedImage(compressed, boxSize)
    }

    fromBuffer(data: ArrayBuffer) {
        const a: ImageBoxes<CompressedBox> = {
            size: {
                width: 16,
                height: 16,
            },
            data: [],
        }

        return new QImgCompressedImage(a, 0)
    }
}

export class QImgCompressedImage implements CompressedImage {
    #boxes: ImageBoxes<CompressedBox>
    #boxSize: number
    constructor(boxes: ImageBoxes<CompressedBox>, boxSize: number) {
        this.#boxes = boxes
        this.#boxSize = boxSize
    }

    toImageData() {
        const result = createImageData(this.#boxes.size.width, this.#boxes.size.height)
        this.#drawBoxes(result)
        return result
    }

    toBuffer() {
        return new ArrayBuffer(64)
    }

    #drawBoxes(target: ImageData) {
        for(const box of this.#boxes.data) {
            for(const pixel of box.data) {
                const x = (box.x * this.#boxSize) + pixel.x
                const y = (box.y * this.#boxSize) + pixel.y

                const index = (target.width * y) + x

                const color = pixel.index ? box.light : box.dark

                target.data[index * 4] = color.r 
                target.data[index * 4 + 1] = color.g
                target.data[index * 4 + 2] = color.b
                target.data[index * 4 + 3] = 255
            }
        }
    }
}