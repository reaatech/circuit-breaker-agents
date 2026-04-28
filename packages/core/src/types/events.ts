export type CircuitEventType =
  | 'stateChange'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'persistenceError'
  | 'callbackError';

export interface CircuitEvent {
  type: CircuitEventType;
  circuit_id: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type EventHandler = (event: CircuitEvent) => void;
