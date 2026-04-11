import { useState, useEffect } from 'react';
import { Download, Smartphone, Share, Plus, MoreVertical, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

const InstallPage = () => {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));
    setIsAndroid(/Android/.test(ua));

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>

        <div className="text-center space-y-2">
          <div className="w-20 h-20 mx-auto rounded-2xl overflow-hidden shadow-lg">
            <img src="/icon-192.png" alt="App icon" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-heading font-bold">Install Smart Attendance</h1>
          <p className="text-muted-foreground text-sm">
            Install this app on your phone for quick access — no app store needed!
          </p>
        </div>

        {isInstalled ? (
          <Card className="border-success/30 bg-success/5">
            <CardContent className="pt-6 text-center">
              <Download className="w-10 h-10 mx-auto text-success mb-3" />
              <p className="font-semibold text-success">App Already Installed!</p>
              <p className="text-sm text-muted-foreground mt-1">You're all set. Open it from your home screen.</p>
            </CardContent>
          </Card>
        ) : deferredPrompt ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Smartphone className="w-10 h-10 mx-auto text-primary" />
              <p className="font-medium">Ready to install</p>
              <Button onClick={handleInstall} className="w-full" size="lg">
                <Download className="w-4 h-4 mr-2" /> Install App
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {isIOS && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Share className="w-5 h-5 text-primary" /> Install on iPhone / iPad
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                    <p>Open this page in <strong className="text-foreground">Safari</strong></p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <p>Tap the <strong className="text-foreground">Share</strong> button <Share className="w-4 h-4 inline" /> at the bottom</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <p>Scroll down and tap <strong className="text-foreground">"Add to Home Screen"</strong> <Plus className="w-4 h-4 inline" /></p>
                  </div>
                </CardContent>
              </Card>
            )}

            {isAndroid && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Smartphone className="w-5 h-5 text-primary" /> Install on Android
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                    <p>Open this page in <strong className="text-foreground">Chrome</strong></p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <p>Tap the <strong className="text-foreground">menu</strong> <MoreVertical className="w-4 h-4 inline" /> (three dots) at the top right</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <p>Tap <strong className="text-foreground">"Install app"</strong> or <strong className="text-foreground">"Add to Home Screen"</strong></p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isIOS && !isAndroid && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Install on Desktop</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>Look for the install icon <Download className="w-4 h-4 inline" /> in your browser's address bar, or use the browser menu to install this app.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="text-center">
          <Button variant="link" size="sm" onClick={() => navigate('/check-attendance')}>
            Check your attendance →
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InstallPage;
