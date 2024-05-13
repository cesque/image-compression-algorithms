import { ImageData, createCanvas, createImageData } from 'canvas'
import { CompressedImage, FullColorPixel, ImageCompressionAlgorithm, Position } from '../index'
import splitIntoBoxes, { Box, ImageBoxes, UncompressedBox } from '../utils/splitIntoBoxes.js'
import { Color } from '../index'
import getLuminance from '../utils/getLuminance'
import getBoxColors from '../utils/getBoxColors'

type CompressedBox = Box & {
    light: Color,
    dark: Color,
    centers: {
        light: Position,
        dark: Position,
    }
}

type GradImgCompressionOptions = {
    boxSize: number,
}

export class GradImg implements ImageCompressionAlgorithm {
    static MAGIC = [99, 115, 113, 47, 103, 114, 97, 100] // csq/grad
    static FILE_EXTENSIONS = ['gradimg']

    getFileExtensions() {
        return GradImg.FILE_EXTENSIONS
    }

    #average(list: FullColorPixel[], boxSize: number): Position {
        if(list.length == 0) return null
        
        const totalPosition = list.reduce((p, c) => {
            return { 
                x: p.x + c.x,
                y: p.y + c.y,
            }
        }, { x: 0, y: 0 })

        return {
            x: totalPosition.x / list.length / boxSize,
            y: totalPosition.y / list.length / boxSize,
        }
    }

    #getCenters(box: UncompressedBox, averageLuminance: number) {
        const lightPixels: FullColorPixel[] = []
        const darkPixels: FullColorPixel[] = []

        for (const pixel of box.data) {
            if (getLuminance(pixel.color) > averageLuminance) {
                lightPixels.push(pixel)
            } else {
                darkPixels.push(pixel)
            }
        }

        return {
            light: this.#average(lightPixels, box.size),
            dark: this.#average(darkPixels, box.size),
        }
    }

    compress(image: ImageData, { boxSize }: GradImgCompressionOptions) {
        if (!boxSize) throw new Error('no argument provided for gradimg option "boxSize"')

        const uncompressedBoxes = splitIntoBoxes(image, boxSize)
        const compressed = uncompressedBoxes.data.map(box => {
            const { averageLuminance, light, dark } = getBoxColors(box)

            // get gradient stops of box
            const centers = this.#getCenters(box, averageLuminance)
            // if gradient cannot be determined, we'll use the light color for whole box
            if (centers.dark?.x == centers.light?.x && centers.dark?.y == centers.light?.y) {
                centers.dark = null
            }

            return {
                x: box.x,
                y: box.y,
                size: box.size,
                light,
                dark,
                centers,
            }
        })

        const data: ImageBoxes<CompressedBox> = {
            size: uncompressedBoxes.size,
            data: compressed,
        }

        return new GradImgCompressedImage(data, boxSize)
    }

    fromBuffer(data: Uint8Array) {
        const a: ImageBoxes<CompressedBox> = {
            size: {
                width: 16,
                height: 16,
            },
            data: [],
        }

        return new GradImgCompressedImage(a, 0)
    }
}

export class GradImgCompressedImage implements CompressedImage {
    #boxes
    #boxSize

    constructor(boxes: ImageBoxes<CompressedBox>, boxSize: number) {
        this.#boxes = boxes
        this.#boxSize = boxSize
    }

    #makeColorString(color) {
        const { r, g, b } = color
        const a = [r, g, b]
        return `rgba(${ a.join(', ') }, 1)`
    }

    toImageData() {
        const { width, height } = this.#boxes.size
        const canvas = createCanvas(width, height)

        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'red'
        ctx.fillRect(0, 0, width, height)

        for (const box of this.#boxes.data) {
            const x = box.x * this.#boxSize
            const y = box.y * this.#boxSize

            if (box.centers.light == null) {
                ctx.fillStyle = this.#makeColorString(box.dark)
            } else if (box.centers.dark == null) {
                ctx.fillStyle = this.#makeColorString(box.light)
            } else {
                const gradient = ctx.createLinearGradient(
                    x + box.centers.light.x * this.#boxSize,
                    y + box.centers.light.y * this.#boxSize,
                    x + box.centers.dark.x * this.#boxSize,
                    y + box.centers.dark.y * this.#boxSize
                )
    
                gradient.addColorStop(0, this.#makeColorString(box.light))
                gradient.addColorStop(1, this.#makeColorString(box.dark))
    
                ctx.fillStyle = gradient
            }

            ctx.fillRect(x, y, this.#boxSize, this.#boxSize)

            // box.yIntercept = 0

            // rendererCtx.fillStyle = makeColorString(box.light)
            // rendererCtx.beginPath()
            // rendererCtx.arc(
            //     x + box.centers.light.x * boxSize,
            //     y + box.centers.light.y * boxSize,
            //     2,
            //     0,
            //     Math.PI * 2
            // )
            // rendererCtx.fill()

            // rendererCtx.fillStyle = makeColorString(box.dark)
            // rendererCtx.beginPath()
            // rendererCtx.arc(
            //     x + box.centers.dark.x * boxSize,
            //     y + box.centers.dark.y * boxSize,
            //     2,
            //     0,
            //     Math.PI * 2
            // )
            // rendererCtx.fill()
        }

        return ctx.getImageData(0, 0, width, height)
    }

    toBuffer() {
        return new Uint8Array(64)
    }
}