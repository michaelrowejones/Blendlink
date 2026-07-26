import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame } from '@react-three/fiber'
import { createR3FCompiledScene } from '../../packages/blendlink/src/reactThreeFiber.ts'

type Evidence = {
  settled: boolean
  phases: string[]
  readyCount: number
  failedCount: number
  failureName: string | null
  failureMessage: string | null
  boundaryErrors: string[]
  committedFixtureNodes: number
}

declare global {
  interface Window {
    __blendlinkMissingCompanionEvidence: Evidence
  }
}

const evidence: Evidence = {
  settled: false,
  phases: [],
  readyCount: 0,
  failedCount: 0,
  failureName: null,
  failureMessage: null,
  boundaryErrors: [],
  committedFixtureNodes: 0,
}
window.__blendlinkMissingCompanionEvidence = evidence

function renderStatus(): void {
  const status = document.getElementById('status')
  if (!status) return
  status.textContent = evidence.settled
    ? `failed=${evidence.failedCount}; ready=${evidence.readyCount}; committed=${evidence.committedFixtureNodes}`
    : `phases=${evidence.phases.join(' > ') || 'starting'}`
}

const MissingCompanionScene = createR3FCompiledScene({
  displayName: 'MissingCompanionFixtureScene',
  descriptor: {
    url: '/fixtures/missing-companion.glb',
    nodes: {},
    playback: { start: 'manual', loop: 'repeat', speed: 1 },
    look: {
      toneMapping: 'none',
      exposure: 1,
      background: 'application',
    },
  },
  prewarm: false,
})

class SceneBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    void _info
    evidence.boundaryErrors.push(error.message)
    evidence.settled = true
    renderStatus()
  }

  render() {
    return this.state.error ? null : this.props.children
  }
}

function WorldProbe() {
  useFrame(({ scene }) => {
    let count = 0
    scene.traverse((object) => {
      if (object.name === 'ExternalTexturePlane') count += 1
    })
    evidence.committedFixtureNodes = count
  })
  return null
}

function App() {
  return (
    <Canvas frameloop="always" dpr={1} gl={{ antialias: false }}>
      <SceneBoundary>
        <MissingCompanionScene
          onLoadStateChange={(state) => {
            evidence.phases.push(state.phase)
            if (state.phase === 'ready') evidence.readyCount += 1
            if (state.phase === 'failed') {
              evidence.failedCount += 1
              evidence.failureName = state.error.name
              evidence.failureMessage = state.error.message
            }
            renderStatus()
          }}
        />
      </SceneBoundary>
      <WorldProbe />
    </Canvas>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
