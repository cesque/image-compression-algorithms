import { ImageData, createCanvas } from 'canvas'
import { CompressedImage, FullColorPixel, ImageCompressionAlgorithm, Position } from '../index'
import splitIntoBoxes, { Box, ImageBoxes, UncompressedBox } from '../utils/splitIntoBoxes.js'
import { Color } from '../index'
import getBoxColors from '../utils/getBoxColors.js'

type Channel = 'r' | 'g' | 'b'

type CompressedBox = Box & {
    centers: {
        [key in Channel]: SingleChannelStops
    }
}

type SingleChannelPixel = Position & {
    value: number,
}

type SingleChannelStop = Position & {
    value: number,
}

type SingleChannelStops = {
    light: SingleChannelStop,
    dark: SingleChannelStop,
}

type GradRGBCompressionOptions = {
    boxSize: number,
    gradientScale: number,
}

function getAverageRGBOfBox(box: UncompressedBox): { [key in Channel]: number } {
    const totals: { [key in Channel]: number } = {
        r: 0,
        g: 0,
        b: 0,
    }

    for (const pixel of box.data) {
        totals.r += pixel.color.r
        totals.g += pixel.color.g
        totals.b += pixel.color.b
    }

    return {
        r: totals.r / box.data.length,
        g: totals.g / box.data.length,
        b: totals.b / box.data.length,
    }
}

export class GradRgb implements ImageCompressionAlgorithm {
    static MAGIC = [99, 115, 113, 47, 103, 114, 103, 98] // csq/grgb
    static FILE_EXTENSIONS = ['gradrgb']

    static GRADIENT_SCALE_MAX = 1

    getFileExtensions() {
        return GradRgb.FILE_EXTENSIONS
    }

    #average(list: SingleChannelPixel[], boxSize: number): SingleChannelStop {
        if(list.length == 0) return { x: 0, y: 0, value: 0 }

        const total = list.reduce((p, c) => {
            return { 
                x: p.x + c.x,
                y: p.y + c.y,
                value: p.value + c.value
            }
        }, { x: 0, y: 0, value: 0 })

        const x = Math.ceil((total.x / list.length / boxSize) * 255)
        const y = Math.ceil((total.y / list.length / boxSize) * 255)
        const value = Math.round(total.value / list.length)

        return {
            x: x == 0 ? 1 : x,
            y: y == 0 ? 1 : y,
            value, 
        }
    }

    #getCenters(box: UncompressedBox): {
        [key in Channel]: SingleChannelStops
    } {
        type RGBChannelCollection = {
            [key in Channel]: SingleChannelPixel[]
        }

        const lightPixels: RGBChannelCollection = { r: [], g: [], b: [] }
        const darkPixels: RGBChannelCollection = { r: [], g: [], b: [] }

        const averages = getAverageRGBOfBox(box)

        const channels: Channel[] = ['r', 'g', 'b']

        for (const pixel of box.data) {
            for (const channel of channels) {
                const singleChannelPixel: SingleChannelPixel = {
                    x: pixel.x,
                    y: pixel.y,
                    value: pixel.color[channel],
                }

                if (pixel.color[channel] >= averages[channel]) {
                    lightPixels[channel].push(singleChannelPixel)
                } else {
                    darkPixels[channel].push(singleChannelPixel)
                }
            }
        }

        return {
            r: {
                light: this.#average(lightPixels.r, box.size),
                dark: this.#average(darkPixels.r, box.size),
            },
            g: {
                light: this.#average(lightPixels.g, box.size),
                dark: this.#average(darkPixels.g, box.size),
            },
            b: {
                light: this.#average(lightPixels.b, box.size),
                dark: this.#average(darkPixels.b, box.size),
            }
        }
    }

    compress(image: ImageData, { boxSize, gradientScale }: GradRGBCompressionOptions) {
        if (!boxSize) throw new Error('no argument provided for gradimg option "boxSize"')

        const uncompressedBoxes = splitIntoBoxes(image, boxSize)
        const compressed = uncompressedBoxes.data.map(box => {
            // get gradient stops of box
            const centers = this.#getCenters(box)
            // if gradient cannot be determined, we'll use the light color for whole box

            return {
                x: box.x,
                y: box.y,
                size: box.size,
                centers,
            }
        })

        const data: ImageBoxes<CompressedBox> = {
            size: uncompressedBoxes.size,
            data: compressed,
        }

        return new GradRgbCompressedImage(data, boxSize, gradientScale)
    }

    fromBuffer(data: Uint8Array) {
        let bytes = Array.from(data)

        const magic = bytes.slice(0, 8)
        bytes = bytes.slice(8)

        if (!magic.every((value, index) => value == GradRgb.MAGIC[index])) {
            throw new Error('incorrect filetype, expecting .gradimg file (header magic mismatch)')
        }

        const versionMajor = bytes.shift()
        const versionMinor = bytes.shift()
        const version = `${ versionMajor }.${ versionMinor }`

        console.log(`loaded gradimg file, version ${ version }`)

        const hasGradientScaling = version != '0.1'
        const gradientScaleByte = hasGradientScaling ? bytes.shift() : null
        const gradientScale = hasGradientScaling
            ? (gradientScaleByte / 255) * GradRgb.GRADIENT_SCALE_MAX
            : 0.5

        const boxSize = bytes.shift()
        const width = bytes.shift()
        const height = bytes.shift()

        const dataLength = (bytes.shift() << 16)
            | (bytes.shift() << 8)
            | bytes.shift()

        // 1 byte x, 1 byte y, 3       * 3             * 2              = 1 + 1 + 18 = 20
        //                     [r,g,b] * [x, y, value] * [light, dark]
        const boxBytesSize = 2 + (3 + 3) + (3 + 3) + (3 + 3)
        
        const boxes: CompressedBox[] = []

        for(let i = 0; i < dataLength; i++) {
            const index = i * boxBytesSize
            const boxBytes = bytes.slice(index, index + boxBytesSize)

            const box: CompressedBox = {
                x: boxBytes[0],
                y: boxBytes[1],
                size: boxSize,
                centers: {
                    r: {
                        light: {
                            x: boxBytes[2],
                            y: boxBytes[3],
                            value: boxBytes[4],
                        },
                        dark: {
                            x: boxBytes[5],
                            y: boxBytes[6],
                            value: boxBytes[7],
                        }
                    },
                    g: {
                        light: {
                            x: boxBytes[8],
                            y: boxBytes[9],
                            value: boxBytes[10],
                        },
                        dark: {
                            x: boxBytes[11],
                            y: boxBytes[12],
                            value: boxBytes[13],
                        }
                    },
                    b: {
                        light: {
                            x: boxBytes[14],
                            y: boxBytes[15],
                            value: boxBytes[16],
                        },
                        dark: {
                            x: boxBytes[17],
                            y: boxBytes[18],
                            value: boxBytes[19],
                        }
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

        return new GradRgbCompressedImage(gradimgData, boxSize, gradientScale)
    }
}

export class GradRgbCompressedImage implements CompressedImage {
    #boxes: ImageBoxes<CompressedBox>
    #boxSize: number
    #gradientScale: number

    constructor(boxes: ImageBoxes<CompressedBox>, boxSize: number, gradientScale: number = 0.5) {
        this.#boxes = boxes
        this.#boxSize = boxSize

        const gradientScaleMin = 1 / 255

        if (gradientScale <= 0 || gradientScale > GradRgb.GRADIENT_SCALE_MAX) {
            throw new Error(`gradient scale must be ${ gradientScaleMin } > x >= ${ GradRgb.GRADIENT_SCALE_MAX } (found ${ gradientScale })`)
        }

        this.#gradientScale = (Math.round((gradientScale / GradRgb.GRADIENT_SCALE_MAX) * 255) / 255) * GradRgb.GRADIENT_SCALE_MAX

        if (this.#gradientScale != gradientScale) {
            console.log(`quantised gradient scale from ${ gradientScale } to ${ this.#gradientScale }`)
        }
    }

    #makeColorString(value: number, channel: 'r' | 'g' | 'b') {     
        const r = channel == 'r' ? value : 0
        const g = channel == 'g' ? value : 0
        const b = channel == 'b' ? value : 0
        const a = [r, g, b]
        return `rgba(${ a.join(', ') }, 1)`
    }

    #transform(n) {
        const value = (((n / 255) - 0.5) * 2) * this.#gradientScale
        return (this.#boxSize / 2) + value * this.#boxSize
    }

    toImageData() {
        const { width, height } = this.#boxes.size
        const canvas = createCanvas(width, height)

        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, width, height)
        ctx.globalCompositeOperation = 'lighten'

        for (const box of this.#boxes.data) {
            const x = box.x * box.size
            const y = box.y * box.size

            // if (box.x != 5 || box.y != 2) continue

            // console.log({ box })

            const channels: Channel[] = ['r', 'g', 'b']

            for (const channel of channels) {
                const stops = box.centers[channel] as SingleChannelStops

                if (stops.dark.x == stops.light.x && stops.dark.y == stops.light.y) {
                    ctx.fillStyle = this.#makeColorString(Math.round(stops.light.value + stops.dark.value) / 2, channel)
                } else if (stops.dark.x == 0 && stops.dark.y == 0) {
                    ctx.fillStyle = this.#makeColorString(stops.light.value, channel)
                } else if (stops.light.x == 0 && stops.light.y == 0) {
                    ctx.fillStyle = this.#makeColorString(stops.dark.value, channel)
                } else {
                    const gradient = ctx.createLinearGradient(
                        x + this.#transform(box.centers[channel].light.x),
                        y + this.#transform(box.centers[channel].light.y),
                        x + this.#transform(box.centers[channel].dark.x),
                        y + this.#transform(box.centers[channel].dark.y)
                    )
        
                    gradient.addColorStop(0, this.#makeColorString(stops.light.value, channel))
                    gradient.addColorStop(1, this.#makeColorString(stops.dark.value, channel))
        
                    ctx.fillStyle = gradient
                }
    
                ctx.fillRect(x, y, this.#boxSize, this.#boxSize)
            }
        }

        return ctx.getImageData(0, 0, width, height)
    }

    toBuffer() {
        const bytes: number[] = []

        // version 0.2 has variable gradient scale
        const version = [0, 2]

        bytes.push(...GradRgb.MAGIC)
        bytes.push(...version)

        const boxesWidth = this.#boxes.size.width / this.#boxSize
        const boxesHeight = this.#boxes.size.height / this.#boxSize

        if (this.#boxSize > 255) throw new Error(`box size too large to be serialised: ${ this.#boxSize }`)
        if (boxesWidth > 255) throw new Error(`image width too large to be serialised: ${ this.#boxes.size.width / this.#boxSize } boxes wide of size ${ this.#boxSize }`)
        if (boxesHeight > 255) throw new Error(`image height too large to be serialised: ${ this.#boxes.size.height / this.#boxSize } boxes tall of size ${ this.#boxSize }`)
        if (this.#boxes.data.length >= (1 << 24)) throw new Error(`image data too large to be serialised: ${ this.#boxes.data.length } (must be able to fit in 24bit integer)`)

        const gradientScaleByte = Math.max(1, Math.round((this.#gradientScale / GradRgb.GRADIENT_SCALE_MAX) * 255))
        bytes.push(gradientScaleByte) // added in v0.2
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

        const channels: Channel[] = ['r', 'g', 'b']

        for(const box of this.#boxes.data) {
            bytes.push(box.x)
            bytes.push(box.y)

            for (const channel of channels) {
                bytes.push(box.centers[channel].light.x)
                bytes.push(box.centers[channel].light.y)
                bytes.push(box.centers[channel].light.value)

                bytes.push(box.centers[channel].dark.x)
                bytes.push(box.centers[channel].dark.y)
                bytes.push(box.centers[channel].dark.value)
            }
        }

        return Uint8Array.from(bytes)
    }
}