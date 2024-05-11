import { Color } from '../index'

export default function getLuminance(color: Color) {
    const r = color.r
    const g = color.g
    const b = color.b
    return Math.sqrt((0.241 * r * r) + (0.691 * g * g) + (0.068 * b * b)) / 255
}