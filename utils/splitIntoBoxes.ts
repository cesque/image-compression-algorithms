import { ImageData } from 'canvas'
import { FullColorPixel, Position } from '../index'

export type ImageBoxes<T> = {
    /** the total width and height of the image in pixels (rounded down to fit nearest box size multiple) */
    size: {
        width: number,
        height: number,
    },
    data: T[],
}

/** a box of image data - x & y position are box location (not pixels) e.g. top left
 * box is 0,0 and the one to the right of that is 1,0, regardless of box size
*/
export type Box = Position & {
    size: number,
}

/** a box of full color pixels */
export type UncompressedBox = Box & {
    data: FullColorPixel[],
}

export default function splitIntoBoxes(imageData: ImageData, boxSize: number): ImageBoxes<UncompressedBox> {
    // get total width and height of image, rounded down to fit nearest box size multiple
    const size = {
        width: boxSize * Math.floor(imageData.width / boxSize),
        height: boxSize * Math.floor(imageData.height / boxSize),
    }

    const data: UncompressedBox[] = []

    for(let y = 0; y < size.height / boxSize; y++) {
        for(let x = 0; x < size.width / boxSize; x++) {
            const xStart = x * boxSize
            const yStart = y * boxSize

            const box: UncompressedBox = {
                x,
                y,
                size: boxSize,
                data: [],
            }

            for(let y1 = 0; y1 < boxSize; y1++) {
                for(let x1 = 0; x1 < boxSize; x1++) {
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