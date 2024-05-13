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
        if(list.length == 0) return { x: 0, y: 0 }
        
        const totalPosition = list.reduce((p, c) => {
            return { 
                x: p.x + c.x,
                y: p.y + c.y,
            }
        }, { x: 0, y: 0 })

        const x = Math.ceil((totalPosition.x / list.length / boxSize) * 255)
        const y = Math.ceil((totalPosition.y / list.length / boxSize) * 255)

        return {
            x: x == 0 ? 1 : x,
            y: y == 0 ? 1 : y
        }
    }

    #getCenters(box: UncompressedBox, averageLuminance: number) {
        const lightPixels: FullColorPixel[] = []
        const darkPixels: FullColorPixel[] = []

        for (const pixel of box.data) {
            if (getLuminance(pixel.color) >= averageLuminance) {
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

            if (centers.dark.x == centers.light.x && centers.dark.y == centers.light.y) {
                centers.dark.x = 0
                centers.dark.y = 0
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
        const header = [...data.slice(0, 16)]
        const rest = data.slice(16)

        const magic = header.slice(0, 8)
        const headerData = header.slice(8, 16)

        if (!magic.every((value, index) => value == GradImg.MAGIC[index])) {
            throw new Error('incorrect filetype, expecting .gradimg file (header magic mismatch)')
        }

        const [
            versionMajor,
            versionMinor,
            boxSize,
            width,
            height,
            ...dataLengthParts
        ] = headerData

        const version = `${ versionMajor }.${ versionMinor }`

        console.log(`loaded gradimg file, version ${ version }`)

        const dataLength = (dataLengthParts[0] << 16)
            | (dataLengthParts[1] << 8)
            | dataLengthParts[2]

        // 1 byte x, 1 byte y, 3 bytes light colour rgb, 3 bytes dark colour rgb, 2 bytes light gradient stop, 2 bytes dark gradient stop
        const boxBytesSize = 2 + 3 + 3 + 2 + 2
        
        const boxes: CompressedBox[] = []

        for(let i = 0; i < dataLength; i++) {
            const index = i * boxBytesSize
            const boxBytes = rest.slice(index, index + boxBytesSize)

            const box: CompressedBox = {
                x: boxBytes[0],
                y: boxBytes[1],
                light: {
                    r: boxBytes[2],
                    g: boxBytes[3],
                    b: boxBytes[4],
                },
                dark: {
                    r: boxBytes[5],
                    g: boxBytes[6],
                    b: boxBytes[7],
                },
                size: boxSize,
                centers: {
                    light: {
                        x: boxBytes[8],
                        y: boxBytes[9],
                    },
                    dark: {
                        x: boxBytes[10],
                        y: boxBytes[11],
                    }
                }
            }

            boxes.push(box)
        }

        const gradimgData: ImageBoxes<CompressedBox> = {
            size: {
                width: width * boxSize,
                height: height * boxSize,
            },
            data: boxes,
        }

        return new GradImgCompressedImage(gradimgData, boxSize)
    }
}

export class GradImgCompressedImage implements CompressedImage {
    #boxes: ImageBoxes<CompressedBox>
    #boxSize: number

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

            if (box.centers.dark.x == 0 && box.centers.dark.y == 0) {
                ctx.fillStyle = this.#makeColorString(box.light)
            } else if (box.centers.light.x == 0 && box.centers.light.y == 0) {
                ctx.fillStyle = this.#makeColorString(box.dark)
            } else {
                const gradient = ctx.createLinearGradient(
                    x + (box.centers.light.x / 255 * box.size),
                    y + (box.centers.light.y / 255 * box.size),
                    x + (box.centers.dark.x / 255 * box.size),
                    y + (box.centers.dark.y / 255 * box.size)
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
        const bytes: number[] = []

        // version 0.2 has byte packing
        const version = [0, 1]

        bytes.push(...GradImg.MAGIC)
        bytes.push(...version)

        const boxesWidth = this.#boxes.size.width / this.#boxSize
        const boxesHeight = this.#boxes.size.height / this.#boxSize

        if (this.#boxSize > 255) throw new Error(`box size too large to be serialised: ${ this.#boxSize }`)
        if (boxesWidth > 255) throw new Error(`image width too large to be serialised: ${ this.#boxes.size.width / this.#boxSize } boxes wide of size ${ this.#boxSize }`)
        if (boxesHeight > 255) throw new Error(`image height too large to be serialised: ${ this.#boxes.size.height / this.#boxSize } boxes tall of size ${ this.#boxSize }`)
        if (this.#boxes.data.length >= (1 << 24)) throw new Error(`image data too large to be serialised: ${ this.#boxes.data.length } (must be able to fit in 24bit integer)`)

        bytes.push(this.#boxSize)
        bytes.push(boxesWidth)
        bytes.push(boxesHeight)

        // data length as 24 bit integer, split into 8 bytes
        const dataLength = [
            (this.#boxes.data.length & (0xFF << 16)) >> 16,
            (this.#boxes.data.length & (0xFF << 8)) >> 8,
            this.#boxes.data.length & (0xFF),
        ]

        bytes.push(...dataLength)

        for(const box of this.#boxes.data) {
            bytes.push(box.x)
            bytes.push(box.y)
    
            bytes.push(box.light.r)
            bytes.push(box.light.g)
            bytes.push(box.light.b)
    
            bytes.push(box.dark.r)
            bytes.push(box.dark.g)
            bytes.push(box.dark.b)

            bytes.push(box.centers.light.x)
            bytes.push(box.centers.light.y)
            bytes.push(box.centers.dark.x)
            bytes.push(box.centers.dark.y)
        }

        return Uint8Array.from(bytes)
    }
}