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
    static FILE_EXTENSIONS = ['qimg']

    getFileExtensions() {
        return QImg.FILE_EXTENSIONS
    }

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

    fromBuffer(data: Uint8Array) {
        const header = [...data.slice(0, 16)]
        const rest = data.slice(16)

        const magic = header.slice(0, 8)
        const headerData = header.slice(8, 16)

        if (!magic.every((value, index) => value == QImg.MAGIC[index])) {
            throw new Error('incorrect filetype, expecting .qimg file (header magic mismatch)')
        }

        const [
            versionMajor,
            versionMinor,
            boxSize,
            width,
            height,
            ...dataLengthParts
        ] = headerData

        console.log(`loaded qimg file, version ${ versionMajor }.${ versionMinor}`)

        const dataLength = (dataLengthParts[0] << 16)
            | (dataLengthParts[1] << 8)
            | dataLengthParts[2]

        // 1 byte x, 1 byte y, 3 bytes light colour rgb, 3 bytes dark colour rgb, and boxSize^2 bytes
        const boxBytesSize = 2 + 3 + 3 + (boxSize ** 2)
        
        const boxes: CompressedBox[] = []

        for(let i = 0; i < dataLength; i++) {
            const index = i * boxBytesSize
            const boxBytes = rest.slice(index, index + boxBytesSize)

            const boxHeader = boxBytes.slice(0, 8)
            const pixels = boxBytes.slice(8)

            const indexedPixels: IndexedPixel[] = []

            for(let y = 0; y < boxSize; y++) {
                for(let x = 0; x < boxSize; x++) {
                    const index = (y * boxSize) + x

                    indexedPixels.push({
                        x,
                        y,
                        index: pixels[index]
                    })
                }
            }

            const box: CompressedBox = {
                x: boxHeader[0],
                y: boxHeader[1],
                light: {
                    r: boxHeader[2],
                    g: boxHeader[3],
                    b: boxHeader[4],
                },
                dark: {
                    r: boxHeader[5],
                    g: boxHeader[6],
                    b: boxHeader[7],
                },
                size: boxSize,
                data: indexedPixels,
            }

            boxes.push(box)
        }


        const qimgData: ImageBoxes<CompressedBox> = {
            size: {
                width: width * boxSize,
                height: height * boxSize,
            },
            data: boxes,
        }

        return new QImgCompressedImage(qimgData, boxSize)
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
        const { width, height } = this.#boxes.size
        const result = createImageData(width, height)
        this.#drawBoxes(result)
        return result
    }

    toBuffer() {
        const bytes: number[] = []

        // version 0.2 has byte packing
        const version = [0, 1]

        bytes.push(...QImg.MAGIC)
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
    
            for(const pixel of box.data) {
                bytes.push(pixel.index)
            }
        }

        return Uint8Array.from(bytes)
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