import { ImageData } from 'canvas'

export interface ImageCompressionAlgorithm {
    compress: (image: ImageData, options: any) => CompressedImage,
    fromBuffer: (data: Uint8Array) => CompressedImage,
    getFileExtensions: () => string[],
}

export interface CompressedImage {
    toImageData: () => ImageData,
    toBuffer: () => Uint8Array,
}

export type Position = {
    x: number,
    y: number,
} 

export type Color = {
    r: number,
    g: number,
    b: number,
}

export type FullColorPixel = Position & {
    color: Color,
}

export { QImg, QImgCompressedImage } from './qimg/QImg'
export { GradImg, GradImgCompressedImage } from './gradimg/GradImg'
export { GradRgb, GradRgbCompressedImage } from './gradrgb/GradRgb'