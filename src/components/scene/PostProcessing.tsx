import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

export function PostProcessing() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        intensity={1.8}
        luminanceThreshold={0.2}
        luminanceSmoothing={0.9}
        radius={0.4}
        mipmapBlur
      />
      <Vignette
        eskil={false}
        offset={0.2}
        darkness={0.85}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  )
}
