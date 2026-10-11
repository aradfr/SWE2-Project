// Officer pages: /officer lists the counters, /officer/:counterId is the desk of one counter.
import { useParams } from 'react-router-dom'
import CounterSelect from './CounterSelect.jsx'
import CounterDesk, { CounterNotFound } from './CounterDesk.jsx'

// Only a positive decimal integer, checked on the text before Number():
// Number alone would accept '0x2', '2.0', '1e1' or '+2' as a counter id.
const COUNTER_ID = /^[1-9]\d*$/

function OfficerPage() {
  const { counterId } = useParams()

  if (counterId === undefined) return <CounterSelect />
  if (!COUNTER_ID.test(counterId)) return <CounterNotFound />
  return <CounterDesk key={counterId} counterId={Number(counterId)} />
}

export default OfficerPage
