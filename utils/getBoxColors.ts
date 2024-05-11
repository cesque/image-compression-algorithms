import { Color } from '../index'
import getLuminance from './getLuminance'
import { UncompressedBox } from './splitIntoBoxes'

/** gets the average luminance of a box, and then the average color of
 * all pixels above the average luminance (light) and the average color
 * or all pixels below the average luminance (dark)
 */
export default function getBoxColors(box: UncompressedBox) {
    const { data } = box

    // --- mean
    const totalLuminance = data.reduce((p, c) => p + getLuminance(c.color), 0)
    const averageLuminance = totalLuminance / data.length

    // --- median
    // let luminances = box.data.map(pixel => this.getLuminance(pixel.color))
    // luminances.sort()
    // let avgLuminance = (luminances[Math.floor(luminances.length / 2)] + luminances[Math.ceil(luminances.length / 2)]) / 2

    const totals = {
        light: { r: 0, g: 0, b: 0, n: 0 },
        dark: { r: 0, g: 0, b: 0, n: 0 },
    }

    for(const pixel of data) {
        const luminance = getLuminance(pixel.color)

        const type = luminance >= averageLuminance ? 'light' : 'dark'
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

    return {
        averageLuminance,
        light,
        dark,
    }
}