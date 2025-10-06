import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type FeedbackVariant = 'info' | 'error' | 'success';

interface FeedbackState {
  message: string;
  variant: FeedbackVariant;
  icon?: string;
}

interface FeedbackContextValue {
  feedback: FeedbackState | null;
  showFeedback: (message: string, options?: { variant?: FeedbackVariant; icon?: string }) => void;
  clearFeedback: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

export const FeedbackProvider = ({ children }: PropsWithChildren) => {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const showFeedback = useCallback(
    (message: string, options?: { variant?: FeedbackVariant; icon?: string }) => {
      setFeedback({
        message,
        variant: options?.variant ?? 'info',
        icon: options?.icon,
      });
    },
    [],
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const value = useMemo(
    () => ({ feedback, showFeedback, clearFeedback }),
    [feedback, showFeedback, clearFeedback],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
};

export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within FeedbackProvider');
  }
  return context;
};
