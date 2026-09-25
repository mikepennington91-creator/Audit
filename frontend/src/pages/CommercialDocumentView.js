import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CommercialDocumentView = () => {
  const { filename } = useParams();
  const [document, setDocument] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    axios.get(`${API}/system/commercial-documents/${encodeURIComponent(filename)}`)
      .then((response) => setDocument(response.data))
      .catch((err) => setError(err.response?.data?.detail || "Could not load document"));
  }, [filename]);
  return <div className="space-y-5">
    <Button variant="ghost" className="px-0" asChild><Link to="/system/commercial-documents">← Commercial & Legal</Link></Button>
    {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">{error}</div>}
    {!document && !error && <p className="text-muted-foreground">Loading document…</p>}
    {document && <>
      <div><p className="text-sm text-muted-foreground">Internal draft</p><h1 className="text-3xl font-bold">{document.title}</h1></div>
      <Card><CardContent className="pt-6">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{document.content}</pre>
      </CardContent></Card>
    </>}
  </div>;
};
export default CommercialDocumentView;
