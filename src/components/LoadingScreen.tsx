import { ClipboardCheck, Loader2 } from 'lucide-react';

const LoadingScreen = ({ message = 'Loading...' }: { message?: string }) => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
    <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center animate-bounce">
      <ClipboardCheck className="w-8 h-8 text-primary-foreground" />
    </div>
    <Loader2 className="w-6 h-6 text-primary animate-spin" />
    <p className="text-sm text-muted-foreground animate-pulse">{message}</p>
  </div>
);

export default LoadingScreen;
