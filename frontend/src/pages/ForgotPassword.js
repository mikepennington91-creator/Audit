import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      await axios.post(`${API}/auth/password-reset/request`, { email: email.trim() });
    } catch {
      // Keep the response deliberately generic so the UI never reveals whether
      // a particular email address belongs to an account.
    } finally {
      setSending(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>Enter the email address used for your Infinit Audit account.</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="text-center space-y-4">
              <Mail className="w-10 h-10 mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">
                If an account exists for that email address, a password reset link will be sent. Check your inbox and spam folder.
              </p>
              <Button asChild variant="outline" className="w-full"><Link to="/login">Return to sign in</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email address</Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending || !email.trim()}>
                {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {sending ? 'Requesting...' : 'Send reset link'}
              </Button>
              <Button asChild type="button" variant="ghost" className="w-full"><Link to="/login">Back to sign in</Link></Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
