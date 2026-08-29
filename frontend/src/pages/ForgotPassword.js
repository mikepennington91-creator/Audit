import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await axios.post(`${API}/auth/password-reset/request`, { email });
      setMessage(response.data.message);
      setEmail('');
    } catch {
      // Keep the public response deliberately generic so this page cannot be
      // used to discover whether an account exists.
      setMessage('If an account exists for that email address, a password reset link will be sent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>Enter the email address used for your Infinit Audit account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? (
            <div className="rounded-md border bg-muted/40 p-4 text-sm">{message}</div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email address</Label>
                <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <Button className="w-full" type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</Button>
            </form>
          )}
          <Button variant="ghost" className="w-full" asChild><Link to="/login">Back to sign in</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
