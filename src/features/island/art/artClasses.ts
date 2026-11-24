/** Classes de pixelArt.module.css pour les dessins en pixel art (île et jardin). */
import type { ArtClassNames } from './pixelArt'
import styles from './pixelArt.module.css'

/** Classes du module, sous la forme attendue par rectClass et createArtSvg. */
export function artClassNames(): ArtClassNames {
  const c = (name: string) => styles[name] ?? ''
  return {
    art: c('art'),
    frameA: c('frameA'),
    frameB: c('frameB'),
    blink: c('blink'),
    sheet: c('sheet'),
    line: c('line'),
    pencilBody: c('pencilBody'),
    pencilTip: c('pencilTip'),
    eraser: c('eraser'),
    folder: c('folder'),
    folderLip: c('folderLip'),
    folderBack: c('folderBack'),
    keys: c('keys'),
    key: c('key'),
    cursor: c('cursor'),
    glass: c('glass'),
    pupil: c('pupil'),
    ring: c('ring'),
    handle: c('handle'),
    gear: c('gear'),
    gearSmall: c('gearSmall'),
  }
}

