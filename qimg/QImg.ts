import { ImageData, createImageData } from 'canvas'
import { CompressedImage, ImageCompressionAlgorithm } from '../index.js'

type WithPosition<T> = T & {
    x: number,
    y: number,
} 

export type Color = {
    r: number,
    g: number,
    b: number,
}

type FullColorPixel = WithPosition<{
    color: Color,
}>

type IndexedPixel = WithPosition<{
    index: number,
}>

type Box = WithPosition<{
    size: number,
}>

type UncompressedBox = Box & {
    data: FullColorPixel[],
}

type CompressedBox = Box & {
    light: Color,
    dark: Color,
    data: IndexedPixel[],
}

type ImageBoxes<T> = {
    size: {
        width: number,
        height: number,
    },
    data: T[],
}

type QImgCompressionOptions = {
    boxSize: number,
}


export class QImg implements ImageCompressionAlgorithm {
    static MAGIC = [99, 115, 113, 47, 113, 105, 109, 103] // csq/qimg
    
    #boxSize: number

    constructor() {
        this.#boxSize = 16
    }

    #splitIntoBoxes(imageData: ImageData): ImageBoxes<UncompressedBox> {
        const size = {
            width: this.#boxSize * Math.floor(imageData.width / this.#boxSize),
            height: this.#boxSize * Math.floor(imageData.height / this.#boxSize),
        }

        const data: UncompressedBox[] = []

        for(let y = 0; y < size.height / this.#boxSize; y++) {
            for(let x = 0; x < size.width / this.#boxSize; x++) {
                const xStart = x * this.#boxSize
                const yStart = y * this.#boxSize

                const box: UncompressedBox = {
                    x,
                    y,
                    size: this.#boxSize,
                    data: [],
                }

                for(let y1 = 0; y1 < this.#boxSize; y1++) {
                    for(let x1 = 0; x1 < this.#boxSize; x1++) {
                        const realY = yStart + y1
                        const realX = xStart + x1

                        const index = (realY * imageData.width) + realX

                        const pixel: FullColorPixel = {
                            x: x1,
                            y: y1,
                            color: {
                                r: imageData.data[index * 4],
                                g: imageData.data[index * 4 + 1],
                                b: imageData.data[index * 4 + 2],
                            }
                        }
                        
                        box.data.push(pixel)
                    }
                }

                data.push(box)
            }
        }

        return {
            size,
            data,
        }
    }

    #getLuminance(color) {
        const r = color.r
        const g = color.g
        const b = color.b
        return Math.sqrt((0.241 * r * r) + (0.691 * g * g) + (0.068 * b * b)) / 255
    }

    #compressBoxes(boxes: ImageBoxes<UncompressedBox>): ImageBoxes<CompressedBox> {
        const compressedBoxes: CompressedBox[] = []

        for(const {x, y, size, data} of boxes.data) {
            // --- mean
            const avgLuminance = data.reduce((p, c) => p + this.#getLuminance(c.color), 0) / data.length
            // --- median
            // let luminances = box.data.map(pixel => this.getLuminance(pixel.color))
            // luminances.sort()
            // let avgLuminance = (luminances[Math.floor(luminances.length / 2)] + luminances[Math.ceil(luminances.length / 2)]) / 2

            const totals = {
                light: { r: 0, g: 0, b: 0, n: 0 },
                dark: { r: 0, g: 0, b: 0, n: 0 },
            }

            for(const pixel of data) {
                const luminance = this.#getLuminance(pixel.color)

                const type = luminance >= avgLuminance ? 'light' : 'dark'
                totals[type].n++
                totals[type].r += pixel.color.r
                totals[type].g += pixel.color.g
                totals[type].b += pixel.color.b
            }

            const light: Color = {
                r: Math.floor(totals.light.r / totals.light.n),
                g: Math.floor(totals.light.g / totals.light.n),
                b: Math.floor(totals.light.b / totals.light.n),
            }

            const dark: Color = {
                r: Math.floor(totals.dark.r / totals.dark.n),
                g: Math.floor(totals.dark.g / totals.dark.n),
                b: Math.floor(totals.dark.b / totals.dark.n),
            }

            const indexedPixels: IndexedPixel[] = []
            for(const {x, y, color} of data) {
                const luminance = this.#getLuminance(color)
                const index = luminance >= avgLuminance ? 1 : 0

                indexedPixels.push({
                    x,
                    y,
                    index,
                })
            }

            compressedBoxes.push({
                x,
                y,
                size,
                light,
                dark,
                data: indexedPixels,
            })
        }

        return {
            size: boxes.size,
            data: compressedBoxes,
        }
    }

    compress(image: ImageData, { boxSize }: QImgCompressionOptions) {
        if (!boxSize) throw new Error('no argument provided for qimg option "boxSize"')

        this.#boxSize = boxSize

        const boxes = this.#splitIntoBoxes(image)
        const compressed = this.#compressBoxes(boxes)
        console.log({ image, boxSize, boxes, compressed })
        
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