import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { extractionRequestSchema, type ExtractionRequest, type ExtractionResult, type ExtractedFile } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Code, 
  Download, 
  Globe, 
  Folder, 
  FolderOpen, 
  FileText, 
  FileCode, 
  Image, 
  File,
  Github,
  Settings,
  AlertTriangle,
  Clock,
  HardDrive,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  files: ExtractedFile[];
  onFileClick: (file: ExtractedFile) => void;
}

const FileTree = ({ files, onFileClick }: FileTreeProps) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));

  const toggleFolder = (folder: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folder)) {
      newExpanded.delete(folder);
    } else {
      newExpanded.add(folder);
    }
    setExpandedFolders(newExpanded);
  };

  const getFileIcon = (type: ExtractedFile["type"]) => {
    switch (type) {
      case 'html': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'css': return <FileCode className="w-4 h-4 text-blue-500" />;
      case 'js': return <FileCode className="w-4 h-4 text-yellow-500" />;
      case 'image': return <Image className="w-4 h-4 text-green-500" />;
      case 'payload': return <File className="w-4 h-4 text-purple-500" />;
      default: return <File className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Group files by folder
  const filesByFolder = files.reduce((acc, file) => {
    const folderPath = file.path.includes('/') ? file.path.split('/')[0] : 'root';
    if (!acc[folderPath]) acc[folderPath] = [];
    acc[folderPath].push(file);
    return acc;
  }, {} as Record<string, ExtractedFile[]>);

  return (
    <div className="space-y-2">
      {Object.entries(filesByFolder).map(([folderName, folderFiles]) => (
        <div key={folderName}>
          <div 
            className="flex items-center space-x-2 text-sm font-medium text-slate-700 cursor-pointer hover:text-slate-900 p-1 rounded hover:bg-slate-50"
            onClick={() => toggleFolder(folderName)}
          >
            {expandedFolders.has(folderName) ? 
              <FolderOpen className="w-4 h-4 text-yellow-500" /> : 
              <Folder className="w-4 h-4 text-yellow-500" />
            }
            <span>{folderName === 'root' ? 'Website Root' : folderName}</span>
            <span className="text-slate-500">({folderFiles.length} files)</span>
          </div>
          
          {expandedFolders.has(folderName) && (
            <div className="ml-6 space-y-1">
              {folderFiles.map((file) => (
                <div 
                  key={file.id}
                  className="flex items-center space-x-2 text-sm text-slate-600 cursor-pointer hover:text-slate-900 p-1 rounded hover:bg-slate-50"
                  onClick={() => onFileClick(file)}
                >
                  {getFileIcon(file.type)}
                  <span className="font-mono">{file.name}</span>
                  <span className="text-slate-400 text-xs ml-auto">{formatFileSize(file.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default function Home() {
  const [currentExtraction, setCurrentExtraction] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ExtractedFile | null>(null);
  const { toast } = useToast();

  const form = useForm<ExtractionRequest>({
    resolver: zodResolver(extractionRequestSchema),
    defaultValues: {
      url: "",
      includePayloads: true,
      includeSourcePage: true,
    },
  });

  const extractMutation = useMutation({
    mutationFn: async (data: ExtractionRequest) => {
      const response = await apiRequest("POST", "/api/extract", data);
      return response.json();
    },
    onSuccess: (result: ExtractionResult) => {
      setCurrentExtraction(result.id);
      toast({
        title: "Extraction Started",
        description: "Website extraction has begun. Please wait...",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Extraction Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: extractionResult, isLoading: isLoadingResult } = useQuery<ExtractionResult>({
    queryKey: ["/api/extract", currentExtraction],
    enabled: !!currentExtraction,
    refetchInterval: (query) => {
      return query.state.data?.status === "processing" ? 2000 : false;
    },
  });

  const downloadZipMutation = useMutation({
    mutationFn: async (extractionId: string) => {
      const response = await fetch(`/api/extract/${extractionId}/download`);
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${new URL(extractionResult?.url || '').hostname}-sources.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({
        title: "Download Started",
        description: "Your ZIP file download has begun.",
      });
    },
  });

  const downloadFileMutation = useMutation({
    mutationFn: async ({ extractionId, fileId, fileName }: { extractionId: string; fileId: string; fileName: string }) => {
      const response = await fetch(`/api/extract/${extractionId}/file/${fileId}`);
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
  });

  const onSubmit = (data: ExtractionRequest) => {
    extractMutation.mutate(data);
  };

  const resetExtraction = () => {
    setCurrentExtraction(null);
    setSelectedFile(null);
    form.reset();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getProgressValue = () => {
    if (!extractionResult) return 0;
    switch (extractionResult.status) {
      case "pending": return 0;
      case "processing": return 50;
      case "completed": return 100;
      case "failed": return 0;
      default: return 0;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <Code className="text-white text-lg" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Website Source Dumper</h1>
                <p className="text-sm text-slate-600">Extract and download website source files</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center space-x-4">
              <span className="text-sm text-slate-500">v1.0.0</span>
              <a href="#" className="text-slate-600 hover:text-slate-900 transition-colors">
                <Github className="text-lg" />
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* URL Input Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Extract Website Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website URL</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="https://example.com"
                            {...field}
                            className="pr-10"
                          />
                          <Globe className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                        </div>
                      </FormControl>
                      <FormDescription>
                        Enter the URL of the website you want to extract sources from
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200">
                  {/* CSS/JS Assets (Always enabled) */}
                  <div className="flex items-center space-x-3 p-3 bg-slate-50 rounded-lg">
                    <Checkbox checked disabled className="opacity-50" />
                    <div>
                      <label className="text-sm font-medium text-slate-700">CSS/JS Assets</label>
                      <p className="text-xs text-slate-500">Always included</p>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="includePayloads"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <FormControl>
                          <Checkbox 
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-0">
                          <FormLabel className="text-sm font-medium cursor-pointer">
                            Include Payloads
                          </FormLabel>
                          <p className="text-xs text-slate-500">API responses & network data</p>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeSourcePage"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        <FormControl>
                          <Checkbox 
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-0">
                          <FormLabel className="text-sm font-medium cursor-pointer">
                            Include Source Page
                          </FormLabel>
                          <p className="text-xs text-slate-500">Original HTML page</p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-4">
                  <Button 
                    type="submit" 
                    className="w-full sm:w-auto"
                    disabled={extractMutation.isPending}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {extractMutation.isPending ? "Starting..." : "Extract Sources"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Extraction Progress */}
        {extractionResult && extractionResult.status === "processing" && (
          <Card className="mb-8">
            <CardContent className="pt-6">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-slate-900">Extracting website sources...</h3>
                  <p className="text-sm text-slate-500 mt-1">Analyzing page structure and downloading assets</p>
                </div>
                <div className="text-sm text-slate-500">{getProgressValue()}%</div>
              </div>
              
              <div className="mt-4">
                <Progress value={getProgressValue()} className="h-2" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {extractionResult && extractionResult.status === "failed" && (
          <Card className="mb-8 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="text-red-500 mt-0.5 w-5 h-5" />
                <div>
                  <h3 className="text-sm font-medium text-red-800">Extraction Failed</h3>
                  <p className="text-sm text-red-600 mt-1">
                    {extractionResult.error || "The website could not be accessed. Please check the URL and try again."}
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="mt-3 text-red-700 border-red-300 hover:bg-red-100"
                    onClick={resetExtraction}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Try Again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Section */}
        {extractionResult && extractionResult.status === "completed" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* File Tree */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Extracted Files</CardTitle>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-slate-500">{extractionResult.totalFiles} files</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-sm text-slate-500">{formatFileSize(extractionResult.totalSize)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <FileTree 
                    files={extractionResult.files} 
                    onFileClick={setSelectedFile}
                  />
                </CardContent>
              </Card>
            </div>
            
            {/* Download and Actions Panel */}
            <div className="space-y-6">
              
              {/* Download Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Download</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">Complete Package</span>
                      <span className="text-sm text-slate-500">{formatFileSize(extractionResult.totalSize)}</span>
                    </div>
                    <Button 
                      className="w-full bg-green-600 hover:bg-green-700"
                      onClick={() => downloadZipMutation.mutate(extractionResult.id)}
                      disabled={downloadZipMutation.isPending}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {new URL(extractionResult.url).hostname}-sources.zip
                    </Button>
                  </div>
                  
                  <div className="text-center">
                    <Button variant="ghost" size="sm">
                      <Settings className="w-4 h-4 mr-1" />
                      Download Options
                    </Button>
                  </div>
                </CardContent>
              </Card>
              
              {/* Extraction Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Source URL:</span>
                    <span className="text-slate-900 font-mono text-xs truncate ml-2 max-w-[150px]">
                      {extractionResult.url}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Extracted:</span>
                    <span className="text-slate-900">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {new Date(extractionResult.extractedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Total Files:</span>
                    <span className="text-slate-900">{extractionResult.totalFiles}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Total Size:</span>
                    <span className="text-slate-900">
                      <HardDrive className="w-3 h-3 inline mr-1" />
                      {formatFileSize(extractionResult.totalSize)}
                    </span>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-slate-200">
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={resetExtraction}
                    >
                      Extract Another Site
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        
      </main>

      {/* File Preview Modal */}
      <Dialog open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-3">
              <FileCode className="text-blue-500 w-5 h-5" />
              <div>
                <div className="text-lg font-semibold">{selectedFile?.name}</div>
                <div className="text-sm text-slate-500 font-normal">
                  {selectedFile && formatFileSize(selectedFile.size)}
                </div>
              </div>
              <div className="ml-auto flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedFile && extractionResult) {
                      downloadFileMutation.mutate({
                        extractionId: extractionResult.id,
                        fileId: selectedFile.id,
                        fileName: selectedFile.name
                      });
                    }
                  }}
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden">
            <div className="h-full bg-slate-900 text-slate-100 p-6 overflow-auto font-mono text-sm rounded-lg">
              <pre className="whitespace-pre-wrap">{selectedFile?.content}</pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
