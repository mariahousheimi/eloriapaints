import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Paintbrush, Pipette, Leaf, ShieldCheck, ArrowRight, Menu, X, Instagram, Facebook, Linkedin, Calendar, Video, MapPin, Clock, LayoutDashboard, LogOut, Trash2, ExternalLink, Mail, Phone, User, FileText, Image, Plus, ChevronDown } from "lucide-react";
import React, { useState, useEffect, FormEvent, useRef } from "react";
import { auth, db, storage } from "./firebase";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  deleteDoc, 
  updateDoc,
  getDocFromServer
} from "firebase/firestore";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import emailjs from '@emailjs/browser';

// --- Types & Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the UI, but we could if needed
  return errInfo;
};

const handleDelete = async (collectionName: string, id: string) => {
  // window.confirm can be blocked in some iframe environments
  try {
    console.log(`Deleting ${id} from ${collectionName}`);
    await deleteDoc(doc(db, collectionName, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
  }
};

// --- Components ---

const AdminDashboard = ({ onClose }: { onClose: () => void }) => {
  const [consultations, setConsultations] = useState<any[]>([]);
  const [quizResults, setQuizResults] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'consultations' | 'quiz' | 'projects'>('consultations');
  const [loading, setLoading] = useState(true);

  // Project Form State
  const [newProject, setNewProject] = useState({ title: '', cat: 'Residential', imgUrl: '' });
  const [projectImage, setProjectImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new window.Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setProjectImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setNewProject(prev => ({ ...prev, imgUrl: '' }));
    } else {
      setImagePreview(null);
    }
  };

  useEffect(() => {
    const qConsultations = query(collection(db, "consultations"), orderBy("createdAt", "desc"));
    const unsubscribeConsultations = onSnapshot(qConsultations, (snapshot) => {
      setConsultations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, "consultations"));

    const qQuiz = query(collection(db, "quizResults"), orderBy("createdAt", "desc"));
    const unsubscribeQuiz = onSnapshot(qQuiz, (snapshot) => {
      setQuizResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "quizResults"));

    const qProjects = query(collection(db, "projects"), orderBy("createdAt", "desc"));
    const unsubscribeProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, "projects"));

    return () => {
      unsubscribeConsultations();
      unsubscribeQuiz();
      unsubscribeProjects();
    };
  }, []);

  const handleProjectUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProject.title) return;
    if (!projectImage && !newProject.imgUrl) {
      alert("Please select an image or provide a URL.");
      return;
    }

    setIsUploading(true);
    setUploadProgress("Preparing image...");
    try {
      let finalImageUrl = newProject.imgUrl;

      if (projectImage) {
        // Attempt cloud storage with a 5s timeout for smoothness
        try {
          console.log("Starting upload to Storage with timeout...");
          setUploadProgress("Uploading to cloud storage...");
          
          const storageRef = ref(storage, `projects/${Date.now()}_${projectImage.name}`);
          
          const uploadPromise = uploadBytes(storageRef, projectImage).then(async (snapshot) => {
            return await getDownloadURL(snapshot.ref);
          });

          const timeoutPromise = new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error("STORAGE_TIMEOUT")), 5000)
          );

          finalImageUrl = await Promise.race([uploadPromise, timeoutPromise]);
          console.log("Upload to Storage successful:", finalImageUrl);
        } catch (storageErr: any) {
          console.warn("Storage unreachable or timed out, falling back to local direct upload...", storageErr);
          setUploadProgress("Optimizing for direct upload...");
          finalImageUrl = await resizeImage(projectImage);
        }
      }

      setUploadProgress("Saving to database...");
      console.log("Saving project to Firestore...");
      await addDoc(collection(db, "projects"), {
        title: newProject.title,
        cat: newProject.cat,
        img: finalImageUrl,
        createdAt: serverTimestamp()
      });

      setNewProject({ title: '', cat: 'Residential', imgUrl: '' });
      setProjectImage(null);
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      alert("Project added successfully!");
    } catch (error: any) {
      console.error("Upload/Save Error:", error);
      alert(`Operation failed: ${error.message || "Please check your internet and try again."}`);
      handleFirestoreError(error, OperationType.CREATE, "projects");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await updateDoc(doc(db, "consultations", id), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `consultations/${id}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-perla-cream flex flex-col"
    >
      <header className="bg-perla-blue text-white p-6 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-4">
          <LayoutDashboard className="text-perla-gold" />
          <h2 className="text-xl font-serif">Company Dashboard</h2>
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={() => signOut(auth)}
            className="text-xs uppercase tracking-widest hover:text-perla-gold transition-colors flex items-center gap-2"
          >
            <LogOut size={16} /> Sign Out
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 transition-colors">
            <X size={24} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 lg:p-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex gap-8 border-b border-perla-blue/10 mb-8">
            <button 
              onClick={() => setActiveTab('consultations')}
              className={`pb-4 text-xs uppercase tracking-widest font-bold transition-all ${activeTab === 'consultations' ? 'text-perla-gold border-b-2 border-perla-gold' : 'text-perla-grey'}`}
            >
              Consultations ({consultations.length})
            </button>
            <button 
              onClick={() => setActiveTab('quiz')}
              className={`pb-4 text-xs uppercase tracking-widest font-bold transition-all ${activeTab === 'quiz' ? 'text-perla-gold border-b-2 border-perla-gold' : 'text-perla-grey'}`}
            >
              Quiz Results ({quizResults.length})
            </button>
            <button 
              onClick={() => setActiveTab('projects')}
              className={`pb-4 text-xs uppercase tracking-widest font-bold transition-all ${activeTab === 'projects' ? 'text-perla-gold border-b-2 border-perla-gold' : 'text-perla-grey'}`}
            >
              Portfolio ({projects.length})
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-perla-gold"></div>
            </div>
          ) : activeTab === 'consultations' ? (
            <div className="grid gap-6">
              {consultations.map((item) => (
                <div key={item.id} className="bg-white p-6 shadow-sm border border-perla-blue/5 flex flex-col md:flex-row justify-between gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <User size={18} className="text-perla-gold" />
                      <h4 className="font-bold text-lg">{item.name}</h4>
                      <span className={`text-[10px] uppercase px-2 py-1 font-bold ${
                        item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 
                        item.status === 'contacted' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4 text-sm text-perla-grey">
                      <div className="flex items-center gap-2"><Mail size={14} /> {item.email}</div>
                      <div className="flex items-center gap-2"><Video size={14} /> {item.meetingType}</div>
                      <div className="flex items-center gap-2"><Calendar size={14} /> {item.preferredDate || 'No date'}</div>
                    </div>
                    {item.message && (
                      <p className="text-sm bg-perla-cream/50 p-4 italic">"{item.message}"</p>
                    )}
                  </div>
                  <div className="flex md:flex-col justify-end gap-2">
                    <select 
                      value={item.status}
                      onChange={(e) => updateStatus(item.id, e.target.value)}
                      className="text-xs p-2 border border-perla-blue/10 outline-none focus:border-perla-gold"
                    >
                      <option value="pending">Pending</option>
                      <option value="contacted">Contacted</option>
                      <option value="completed">Completed</option>
                    </select>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete('consultations', item.id);
                      }}
                      className="p-3 text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center rounded-full"
                      title="Delete Consultation"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))}
              {consultations.length === 0 && <p className="text-center text-perla-grey py-12">No consultation requests yet.</p>}
            </div>
          ) : activeTab === 'quiz' ? (
            <div className="grid gap-6">
              {quizResults.map((item) => (
                <div key={item.id} className="bg-white p-6 shadow-sm border border-perla-blue/5 flex justify-between items-center">
                  <div>
                    <h4 className="font-bold mb-1">{item.name}</h4>
                    <p className="text-sm text-perla-grey mb-2">{item.email}</p>
                    <p className="text-perla-gold font-serif italic">{item.result}</p>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete('quizResults', item.id);
                    }}
                    className="p-3 text-red-500 hover:bg-red-50 transition-colors rounded-full"
                    title="Delete Quiz Result"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              ))}
              {quizResults.length === 0 && <p className="text-center text-perla-grey py-12">No quiz results yet.</p>}
            </div>
          ) : (
            <div className="space-y-12">
              <div className="bg-white p-8 border border-perla-blue/5 shadow-sm">
                <h3 className="text-xl font-serif mb-6 flex items-center gap-2">
                  <Plus className="text-perla-gold" /> Add New Project
                </h3>
                <form onSubmit={handleProjectUpload} className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Project Title</label>
                    <input 
                      required
                      type="text" 
                      value={newProject.title}
                      onChange={e => setNewProject({...newProject, title: e.target.value})}
                      className="w-full bg-perla-cream/30 border-b border-perla-blue/20 py-2 px-3 focus:border-perla-gold outline-none"
                      placeholder="e.g. The Heights Estate"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Category</label>
                    <select 
                      value={newProject.cat}
                      onChange={e => setNewProject({...newProject, cat: e.target.value})}
                      className="w-full bg-perla-cream/30 border-b border-perla-blue/20 py-2 px-3 focus:border-perla-gold outline-none"
                    >
                      <option value="Residential">Residential</option>
                      <option value="Commercial">Commercial</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Project Image (File)</label>
                    <div className="flex items-center gap-4">
                      {imagePreview && (
                        <div className="w-12 h-12 bg-perla-grey/10 border border-perla-blue/10 overflow-hidden shrink-0">
                          <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImageChange}
                        accept="image/*"
                        className="w-full text-xs file:mr-4 file:py-2 file:px-4 file:border-0 file:text-xs file:font-bold file:bg-perla-gold file:text-white hover:file:bg-perla-blue transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">OR Image URL</label>
                    <input 
                      type="url" 
                      value={newProject.imgUrl}
                      onChange={e => {
                        setNewProject({...newProject, imgUrl: e.target.value});
                        setProjectImage(null);
                        setImagePreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="w-full bg-perla-cream/30 border-b border-perla-blue/20 py-2 px-3 focus:border-perla-gold outline-none"
                      placeholder="https://images.unsplash.com/..."
                    />
                  </div>
                  <div className="md:col-span-2 lg:col-span-4">
                    <button 
                      disabled={isUploading}
                      className="btn-gold w-full flex items-center justify-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {uploadProgress}
                        </>
                      ) : (
                        <>
                          <Image size={18} /> Upload Project
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((project) => (
                  <div key={project.id} className="bg-white group relative overflow-hidden shadow-sm border border-perla-blue/5">
                    <div className="aspect-video overflow-hidden">
                      <img 
                        src={project.img} 
                        alt={project.title} 
                        className="w-full h-full object-cover transition-all duration-500"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-4 flex justify-between items-center">
                      <div>
                        <h4 className="font-bold text-sm">{project.title}</h4>
                        <p className="text-[10px] uppercase tracking-widest text-perla-gold">{project.cat}</p>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete('projects', project.id);
                        }}
                        className="p-3 text-red-500 hover:bg-red-50 transition-colors rounded-full relative z-10"
                        title="Delete Project"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {projects.length === 0 && <p className="text-center text-perla-grey py-12">No projects in portfolio yet.</p>}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const ColorQuiz = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState({ name: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);

  const questions = [
    {
      q: "What is the primary mood of your space?",
      options: ["Serene & Minimal", "Bold & Dramatic", "Warm & Organic", "Industrial & Raw"]
    },
    {
      q: "Which architectural element do you value most?",
      options: ["Natural Light", "Structural Symmetry", "Textural Depth", "Open Concept"]
    },
    {
      q: "What is your preferred finish texture?",
      options: ["Matte & Velvety", "High-Gloss Mirror", "Subtle Eggshell", "Hand-Textured Plaster"]
    }
  ];

  const handleAnswer = (ans: string) => {
    const newAnswers = [...answers, ans];
    setAnswers(newAnswers);
    if (step < questions.length - 1) {
      setStep(step + 1);
    } else {
      const palettes = [
        "The Ethereal Collection: Soft greys and muted creams.",
        "The Sovereign Suite: Deep navies and brushed gold accents.",
        "The Earthbound Series: Olive greens and terracotta clays.",
        "The Urban Monolith: Charcoal slates and cool concrete tones."
      ];
      setResult(palettes[Math.floor(Math.random() * palettes.length)]);
    }
  };

  const saveResult = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // 1. Save to Database
      await addDoc(collection(db, "quizResults"), {
        ...userInfo,
        result,
        createdAt: serverTimestamp()
      });

      // 2. Send Email via EmailJS (if configured)
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
      const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

      if (serviceId && templateId && publicKey) {
        try {
          await emailjs.send(
            serviceId,
            templateId,
            {
              to_name: userInfo.name,
              to_email: userInfo.email,
              quiz_result: result,
              message: "Thank you for taking our Color Quiz! Here is your personalized palette."
            },
            publicKey
          );
          console.log("Email sent successfully");
        } catch (emailError) {
          console.error("Failed to send email:", emailError);
        }
      } else {
        console.warn("EmailJS not configured. Results saved to database but no email sent.");
      }

      onClose();
      alert("Your palette has been saved and your implementation guide has been sent to your email!");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "quizResults");
    } finally {
      setIsSaving(false);
    }
  };

  const reset = () => {
    setStep(0);
    setAnswers([]);
    setResult(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-perla-blue/40 backdrop-blur-sm"
        >
          <motion.div 
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="bg-perla-cream w-full max-w-lg p-10 relative shadow-2xl border border-perla-gold/20"
          >
            <button onClick={onClose} className="absolute top-6 right-6 text-perla-blue hover:text-perla-gold transition-colors">
              <X size={24} />
            </button>

            {!result ? (
              <div>
                <span className="text-perla-gold uppercase tracking-widest text-[10px] font-bold mb-4 block">Question {step + 1} of {questions.length}</span>
                <h3 className="text-2xl font-serif mb-8">{questions[step].q}</h3>
                <div className="space-y-3">
                  {questions[step].options.map((opt, i) => (
                    <button 
                      key={i}
                      onClick={() => handleAnswer(opt)}
                      className="w-full text-left p-4 border border-perla-blue/10 hover:border-perla-gold hover:bg-white transition-all text-sm uppercase tracking-widest"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <span className="text-perla-gold uppercase tracking-widest text-[10px] font-bold mb-4 block">Your Architectural Palette</span>
                <h3 className="text-3xl font-serif mb-6 italic">{result}</h3>
                
                <form onSubmit={saveResult} className="space-y-4 text-left">
                  <p className="text-perla-grey text-sm mb-4 leading-relaxed text-center">
                    Enter your details to save this palette and receive a professional implementation guide.
                  </p>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-widest">Name</label>
                    <input 
                      required 
                      type="text" 
                      value={userInfo.name}
                      onChange={e => setUserInfo({...userInfo, name: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 outline-none focus:border-perla-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-widest">Email</label>
                    <input 
                      required 
                      type="email" 
                      value={userInfo.email}
                      onChange={e => setUserInfo({...userInfo, email: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 outline-none focus:border-perla-gold"
                    />
                  </div>
                  <button 
                    disabled={isSaving}
                    className="btn-gold w-full mt-4"
                  >
                    {isSaving ? "Saving..." : "Get Implementation Guide"}
                  </button>
                  <button type="button" onClick={reset} className="w-full text-xs uppercase tracking-widest font-bold text-perla-grey hover:text-perla-blue transition-colors">Retake Quiz</button>
                </form>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Navbar = ({ onConsultation }: { onConsultation: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed w-full z-50 bg-perla-cream/90 backdrop-blur-md border-b border-perla-blue/10">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-4 flex justify-between items-center">
        <div 
          className="text-2xl font-serif font-bold tracking-tighter text-perla-blue cursor-pointer"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ELORIA<span className="text-perla-gold">PAINTS</span>
        </div>
        
        <div className="hidden md:flex space-x-8 items-center">
          <a href="#services" className="text-xs uppercase tracking-widest hover:text-perla-gold transition-colors">Services</a>
          <a href="#process" className="text-xs uppercase tracking-widest hover:text-perla-gold transition-colors">The Process</a>
          <a href="#portfolio" className="text-xs uppercase tracking-widest hover:text-perla-gold transition-colors">Portfolio</a>
          <button onClick={onConsultation} className="btn-gold py-2 px-6">Consultation</button>
        </div>

        <button className="md:hidden text-perla-blue" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden bg-perla-cream border-b border-perla-blue/10 p-6 flex flex-col space-y-4"
        >
          <a href="#services" onClick={() => setIsOpen(false)} className="text-sm uppercase tracking-widest">Services</a>
          <a href="#process" onClick={() => setIsOpen(false)} className="text-sm uppercase tracking-widest">The Process</a>
          <a href="#portfolio" onClick={() => setIsOpen(false)} className="text-sm uppercase tracking-widest">Portfolio</a>
          <button 
            onClick={() => { setIsOpen(false); onConsultation(); }}
            className="btn-gold w-full"
          >
            Request Consultation
          </button>
        </motion.div>
      )}
    </nav>
  );
};

const Hero = ({ onConsultation }: { onConsultation: () => void }) => {
  return (
    <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img 
          src="https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&q=80&w=2000" 
          alt="Luxury Interior" 
          className="w-full h-full object-cover opacity-20"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-perla-cream via-perla-cream/80 to-transparent"></div>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10 grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
        >
          <span className="text-perla-gold uppercase tracking-[0.3em] text-xs font-semibold mb-4 block">Mastering the Art of Finish</span>
          <h1 className="text-5xl md:text-7xl lg:text-8xl leading-[0.9] mb-8">
            Transform Your Space Into a <span className="italic text-perla-gold">Masterpiece.</span>
          </h1>
          <p className="text-lg md:text-xl text-perla-grey max-w-lg mb-10 leading-relaxed">
            From bespoke color formulation to flawless execution, Eloria Paints delivers the ultimate standard in premium residential and commercial finishes.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={onConsultation} className="btn-gold flex items-center justify-center group">
              Request a Consultation <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" size={18} />
            </button>
            <button 
              onClick={() => document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth' })}
              className="btn-outline"
            >
              View Our Work
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="hidden lg:block relative"
        >
          <div className="aspect-[4/5] bg-perla-blue overflow-hidden shadow-2xl">
            <img 
              src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&q=80&w=1000" 
              alt="Premium Paint Finish" 
              className="w-full h-full object-cover mix-blend-overlay opacity-80"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="absolute -bottom-10 -left-10 bg-perla-gold p-8 text-white max-w-[240px] shadow-xl">
            <p className="text-3xl font-serif mb-2">25+</p>
            <p className="text-xs uppercase tracking-widest leading-relaxed">Years of Unrivaled Craftsmanship</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

const ArchitectSpotlight = () => {
  const [isActive, setIsActive] = useState(false);

  return (
    <section className="bg-perla-blue py-24 relative overflow-hidden">
      {/* Background architectural sketch pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid lg:grid-cols-12 gap-16 items-center">
          <div className="lg:col-span-5 flex flex-col items-center lg:items-start order-2 lg:order-1 mt-12 lg:mt-0">
            <div className="relative group">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                onTap={() => setIsActive(!isActive)}
                className="relative w-full max-w-[280px] lg:max-w-[340px] cursor-pointer"
              >
                <div className="aspect-[3/4] bg-perla-grey/20 overflow-hidden border border-white/10 shadow-2xl relative">
                  <img 
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=800" 
                    alt="Our Founder & Lead Architect" 
                    draggable={false}
                    className="w-full h-full object-cover transition-all duration-700 no-select pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                  {/* Transparent protection layer */}
                  <div className="absolute inset-0 z-10" />
                </div>
                {/* Quote box - positioned so it doesn't overlap text below easily */}
                <div className="absolute -bottom-6 -right-6 bg-perla-gold p-6 shadow-2xl hidden sm:block z-20 group-hover:translate-x-2 group-hover:-translate-y-2 transition-transform duration-500">
                  <p className="text-white font-serif italic text-sm leading-tight">"Precision is the <br/>soul of architecture."</p>
                </div>
              </motion.div>
              {/* Visible Title for CEO */}
              <div className="mt-10 text-center lg:text-left">
                <h4 className="text-perla-gold font-bold tracking-widest text-xs uppercase mb-1">Our Founder & Lead Architect</h4>
                <p className="text-white/40 text-[10px] uppercase tracking-[0.2em]">Mastering the Art of the Finish</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 text-white order-1 lg:order-2">
            <span className="text-perla-gold uppercase tracking-[0.3em] text-xs font-semibold mb-6 block">The Visionary Behind Eloria</span>
            <h2 className="text-4xl md:text-6xl mb-8 leading-tight">Architect-Led Precision <br className="hidden md:block" /> in Every Stroke.</h2>
            <p className="text-perla-grey text-lg mb-8 leading-relaxed italic">
              "As an architect, I don't see paint as a covering, but as a structural element of light and space. I personally plan every project and oversee every formulation to ensure that the architectural integrity of your home is never compromised."
            </p>
            
            <div className="grid sm:grid-cols-2 gap-8 mb-12">
              <div>
                <h4 className="text-perla-gold uppercase tracking-widest text-xs font-bold mb-3">Hands-On Leadership</h4>
                <p className="text-sm text-perla-grey leading-relaxed">Every color palette and technical plan is personally drafted by our CEO, ensuring no detail is lost in translation from concept to finish.</p>
              </div>
              <div>
                <h4 className="text-perla-gold uppercase tracking-widest text-xs font-bold mb-3">The Science of Finish</h4>
                <p className="text-sm text-perla-grey leading-relaxed">Follow my daily insights on social media where I break down the chemistry and physics of luxury architectural coatings.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <button 
                onClick={(e) => e.preventDefault()}
                className="btn-gold py-4 px-10 flex items-center group"
              >
                Follow My Architectural Journey <Instagram className="ml-2 group-hover:rotate-12 transition-transform" size={18} />
              </button>
              <div className="flex space-x-6">
                <a href="https://facebook.com" target="_blank" rel="noopener noreferrer">
                  <Facebook size={24} className="text-perla-gold hover:text-white transition-colors cursor-pointer" />
                </a>
                <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer">
                  <Linkedin size={24} className="text-perla-gold hover:text-white transition-colors cursor-pointer" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Services = () => {
  const services = [
    {
      icon: <Paintbrush className="text-perla-gold" size={32} />,
      title: "Interior & Exterior Painting",
      desc: "Precision application for high-end residences and commercial landmarks, ensuring a flawless, lasting impression."
    },
    {
      icon: <Pipette className="text-perla-gold" size={32} />,
      title: "The Science of Perla",
      desc: "Proprietary color matching technology that captures the exact essence of your vision with chemical precision."
    },
    {
      icon: <Leaf className="text-perla-gold" size={32} />,
      title: "Eco-Friendly Solutions",
      desc: "Sustainable, low-VOC manufacturing processes that protect both your environment and your health without compromising quality."
    },
    {
      icon: <ShieldCheck className="text-perla-gold" size={32} />,
      title: "Surface Restoration",
      desc: "Advanced preparation techniques that address structural integrity before the first drop of paint is ever applied."
    }
  ];

  return (
    <section id="services" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 items-end mb-20">
          <div>
            <span className="text-perla-gold uppercase tracking-widest text-xs font-semibold mb-4 block">Our Expertise</span>
            <h2 className="text-4xl md:text-6xl leading-tight">Comprehensive Finish Solutions for the Discerning Client.</h2>
          </div>
          <p className="text-perla-grey text-lg leading-relaxed max-w-md">
            We don't just apply paint; we engineer environments. Our multi-disciplinary approach combines manufacturing excellence with master-level contracting.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {services.map((s, i) => (
            <motion.div 
              key={i}
              whileHover={{ y: -10 }}
              className="p-8 border border-perla-blue/5 bg-perla-cream/30 hover:bg-perla-cream transition-colors"
            >
              <div className="mb-6">{s.icon}</div>
              <h3 className="text-xl mb-4">{s.title}</h3>
              <p className="text-perla-grey text-sm leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Process = () => {
  const steps = [
    { num: "01", title: "Consultation", desc: "In-depth analysis of light, architecture, and lifestyle requirements." },
    { num: "02", title: "Formulation", desc: "Custom pigment engineering in our state-of-the-art laboratory." },
    { num: "03", title: "Preparation", desc: "Rigorous surface restoration to ensure absolute longevity." },
    { num: "04", title: "Execution", desc: "Master-level application with meticulous attention to detail." }
  ];

  return (
    <section id="process" className="py-24 bg-perla-blue text-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="text-center mb-20">
          <span className="text-perla-gold uppercase tracking-widest text-xs font-semibold mb-4 block">The Eloria Process</span>
          <h2 className="text-4xl md:text-6xl">A Legacy Built on Precision.</h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-0 border-t border-white/10">
          {steps.map((step, i) => (
            <div key={i} className="p-10 border-r border-b border-white/10 group hover:bg-white/5 transition-colors">
              <span className="text-5xl font-serif text-perla-gold/30 group-hover:text-perla-gold transition-colors mb-8 block">{step.num}</span>
              <h3 className="text-xl mb-4 uppercase tracking-widest">{step.title}</h3>
              <p className="text-perla-grey text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Portfolio = ({ isAdmin }: { isAdmin: boolean }) => {
  const [filter, setFilter] = useState('All');
  const [projects, setProjects] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, "projects"));
    return () => unsubscribe();
  }, []);

  const filteredProjects = filter === 'All' 
    ? projects 
    : projects.filter(p => p.cat === filter);

  const displayedProjects = (filter === 'All' && !showAll) 
    ? filteredProjects.slice(0, 2) 
    : filteredProjects;

  return (
    <section id="portfolio" className="py-24 bg-perla-cream">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
          <div>
            <span className="text-perla-gold uppercase tracking-widest text-xs font-semibold mb-4 block">Portfolio</span>
            <h2 className="text-4xl md:text-6xl">Recent Transformations.</h2>
          </div>
          <div className="flex space-x-4">
            {['All', 'Residential', 'Commercial'].map((f) => (
              <button 
                key={f}
                onClick={() => {
                  setFilter(f);
                  setShowAll(false);
                  setActiveProjectId(null);
                }}
                className={`text-xs uppercase tracking-widest font-bold pb-1 transition-all ${
                  filter === f 
                    ? 'border-b-2 border-perla-gold text-perla-blue' 
                    : 'text-perla-grey hover:text-perla-blue'
                }`}
              >
                {f === 'All' ? 'All Projects' : f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-perla-gold"></div>
          </div>
        ) : (
          <>
            <motion.div layout className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              <AnimatePresence mode="popLayout">
                {displayedProjects.map((p) => (
                  <motion.div 
                    key={p.id} 
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.4 }}
                    whileHover={{ scale: 0.98 }}
                    className="group relative overflow-hidden cursor-pointer"
                    onTap={() => setActiveProjectId(activeProjectId === p.id ? null : p.id)}
                  >
                    <div className="aspect-[3/4] overflow-hidden bg-perla-blue/5 relative">
                      <img 
                        src={p.img} 
                        alt={p.title} 
                        draggable={false}
                        className="w-full h-full object-cover transition-all duration-1000 scale-110 group-hover:scale-105 no-select pointer-events-none"
                        referrerPolicy="no-referrer"
                      />
                      {/* Transparent protection layer */}
                      <div className="absolute inset-0 z-10" />
                      
                      {isAdmin && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete('projects', p.id);
                          }}
                          className="absolute top-4 right-4 z-[50] bg-red-500 text-white p-3 rounded-full shadow-xl hover:bg-red-600 transition-all opacity-0 lg:group-hover:opacity-100 active:scale-95"
                          title="Quick Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                    <div className={`absolute inset-0 bg-perla-blue/40 backdrop-blur-[2px] transition-all duration-500 flex flex-col items-center justify-center p-8 text-white z-20 ${activeProjectId === p.id ? 'opacity-100' : 'opacity-0 lg:group-hover:opacity-100'}`}>
                      <p className="text-[10px] uppercase tracking-[0.3em] mb-4 text-perla-gold font-bold">{p.cat}</p>
                      <h3 className="text-3xl font-serif text-center leading-tight">{p.title}</h3>
                      <div className="w-12 h-[1px] bg-perla-gold mt-6 transition-all duration-700 scale-x-0 group-hover:scale-x-100" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {filter === 'All' && filteredProjects.length > 2 && !showAll && (
              <div className="mt-16 text-center">
                <button 
                  onClick={() => setShowAll(true)}
                  className="btn-outline flex items-center justify-center mx-auto group"
                >
                  View More <ChevronDown className="ml-2 group-hover:translate-y-1 transition-transform" size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const Contact = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    meetingType: 'Zoom Meeting',
    preferredDate: '',
    message: ''
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "consultations"), {
        ...formData,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      // Send Email via EmailJS (if configured)
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
      const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

      if (serviceId && templateId && publicKey) {
        try {
          await emailjs.send(
            serviceId,
            templateId, // Ideally you could use a different template ID for consultations
            {
              to_name: formData.name,
              to_email: formData.email,
              meeting_type: formData.meetingType,
              preferred_date: formData.preferredDate,
              message: formData.message || "No message provided.",
              subject: "Consultation Request Confirmation"
            },
            publicKey
          );
        } catch (emailError) {
          console.error("Failed to send consultation email:", emailError);
        }
      }

      setSubmitted(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "consultations");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-24 mb-16">
          <div>
            <span className="text-perla-gold uppercase tracking-widest text-xs font-semibold mb-4 block">Book a Consultation</span>
            <h2 className="text-4xl md:text-6xl mb-8">Schedule Your Architectural Review.</h2>
            <p className="text-perla-grey text-lg mb-12 leading-relaxed">
              Meet with our professional team to discuss your project details in-person or via a secure Zoom session. We'll review your architectural plans and develop a bespoke finish strategy.
            </p>
            
            <div className="space-y-6">
              <div className="flex items-start space-x-4">
                <div className="bg-perla-cream p-3 text-perla-gold"><Video size={20} /></div>
                <div>
                  <p className="font-bold uppercase tracking-widest text-xs mb-1">Virtual Consultation</p>
                  <p className="text-sm text-perla-grey">Secure Zoom sessions for initial planning and color matching.</p>
                </div>
              </div>
              <div className="flex items-start space-x-4">
                <div className="bg-perla-cream p-3 text-perla-gold"><MapPin size={20} /></div>
                <div>
                  <p className="font-bold uppercase tracking-widest text-xs mb-1">On-Site Review</p>
                  <p className="text-sm text-perla-grey">In-person architectural assessments for complex projects.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-perla-cream p-10 lg:p-16 relative overflow-hidden">
            {submitted ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="h-full flex flex-col items-center justify-center text-center"
              >
                <div className="bg-perla-gold text-white p-6 rounded-full mb-8">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-3xl font-serif mb-4">Request Received.</h3>
                <p className="text-perla-grey text-sm mb-8 max-w-xs">Our concierge will contact you within 24 hours to confirm your appointment details.</p>
                <button onClick={() => setSubmitted(false)} className="text-xs uppercase tracking-widest font-bold border-b border-perla-blue pb-1">Send Another Request</button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Full Name</label>
                    <input 
                      required 
                      type="text" 
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 focus:border-perla-gold outline-none transition-colors" 
                      placeholder="John Doe" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Email Address</label>
                    <input 
                      required 
                      type="email" 
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 focus:border-perla-gold outline-none transition-colors" 
                      placeholder="john@example.com" 
                    />
                  </div>
                </div>
                
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Meeting Type</label>
                    <select 
                      value={formData.meetingType}
                      onChange={e => setFormData({...formData, meetingType: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 focus:border-perla-gold outline-none transition-colors appearance-none"
                    >
                      <option>Zoom Meeting</option>
                      <option>In-Person Visit</option>
                      <option>Phone Consultation</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold">Preferred Date</label>
                    <input 
                      required 
                      type="date" 
                      min={new Date().toISOString().split('T')[0]}
                      value={formData.preferredDate}
                      onChange={e => setFormData({...formData, preferredDate: e.target.value})}
                      className="w-full bg-transparent border-b border-perla-blue/20 py-2 focus:border-perla-gold outline-none transition-colors" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold">Project Vision</label>
                  <textarea 
                    rows={3} 
                    value={formData.message}
                    onChange={e => setFormData({...formData, message: e.target.value})}
                    className="w-full bg-transparent border-b border-perla-blue/20 py-2 focus:border-perla-gold outline-none transition-colors resize-none" 
                    placeholder="Describe your space..."
                  ></textarea>
                </div>
                
                <button disabled={isSubmitting} className="btn-gold w-full mt-8 flex items-center justify-center">
                  {isSubmitting ? "Processing..." : "Schedule Appointment"}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="max-w-3xl mx-auto p-8 bg-perla-blue text-white text-center">
          <h4 className="text-xl mb-4 italic font-serif text-perla-gold">The Color Quiz</h4>
          <p className="text-sm text-perla-grey mb-6">Discover your architectural personality and get a curated palette in 2 minutes.</p>
          <button 
            onClick={() => window.dispatchEvent(new CustomEvent('openQuiz'))}
            className="text-xs uppercase tracking-widest font-bold border-b border-perla-gold pb-1 hover:text-perla-gold transition-colors"
          >
            Start the Quiz
          </button>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="bg-perla-blue text-white pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 mb-24">
          <div className="lg:col-span-2">
            <div className="text-3xl font-serif font-bold tracking-tighter mb-8 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              ELORIA<span className="text-perla-gold">PAINTS</span>
            </div>
            <p className="text-perla-grey max-w-sm leading-relaxed mb-8">
              Redefining the standard of luxury finishes through scientific innovation and master craftsmanship.
            </p>
            <div className="flex space-x-6">
              <a href="#" onClick={(e) => e.preventDefault()}>
                <Instagram size={20} className="text-perla-grey hover:text-perla-gold cursor-pointer transition-colors" />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer">
                <Facebook size={20} className="text-perla-grey hover:text-perla-gold cursor-pointer transition-colors" />
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer">
                <Linkedin size={20} className="text-perla-grey hover:text-perla-gold cursor-pointer transition-colors" />
              </a>
            </div>
          </div>
          
          <div>
            <h5 className="text-xs uppercase tracking-[0.2em] font-bold mb-8 text-perla-gold">Navigation</h5>
            <ul className="space-y-4 text-sm text-perla-grey">
              <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
              <li><a href="#services" className="hover:text-white transition-colors">Services</a></li>
              <li><a href="#portfolio" className="hover:text-white transition-colors">Portfolio</a></li>
              <li><a href="#contact" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>

          <div>
            <h5 className="text-xs uppercase tracking-[0.2em] font-bold mb-8 text-perla-gold">Contact</h5>
            <ul className="space-y-4 text-sm text-perla-grey">
              <li>123 Architectural Way</li>
              <li>Design District, LB 10001</li>
              <li>+961 70 000 000</li>
              <li>concierge@eloriapaints.com</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-[10px] uppercase tracking-widest text-perla-grey">© 2026 Eloria Paints Manufacturing & Contracting. All Rights Reserved.</p>
          <div className="flex space-x-8 text-[10px] uppercase tracking-widest text-perla-grey">
            <button 
              onClick={async () => {
                const provider = new GoogleAuthProvider();
                try {
                  await signInWithPopup(auth, provider);
                } catch (error) {
                  console.error("Login failed", error);
                }
              }}
              className="hover:text-white transition-colors"
            >
              Company Login
            </button>
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default function App() {
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    const handleOpenQuiz = () => setIsQuizOpen(true);
    window.addEventListener('openQuiz', handleOpenQuiz);
    
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Check if admin (based on rules or email)
      if (u?.email === "mariahouchaimi8@gmail.com") {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    });

    return () => {
      window.removeEventListener('openQuiz', handleOpenQuiz);
      unsubscribe();
    };
  }, []);

  const scrollToContact = () => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen selection:bg-perla-gold selection:text-white">
      <Navbar onConsultation={scrollToContact} />
      
      {isAdmin && (
        <button 
          onClick={() => setShowDashboard(true)}
          className="fixed bottom-8 right-8 z-[150] bg-perla-blue text-white p-4 rounded-full shadow-2xl hover:bg-perla-gold transition-all group"
        >
          <LayoutDashboard size={24} />
          <span className="absolute right-full mr-4 bg-perla-blue px-3 py-1 text-[10px] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Admin Dashboard</span>
        </button>
      )}

      <AnimatePresence>
        {showDashboard && <AdminDashboard onClose={() => setShowDashboard(false)} />}
      </AnimatePresence>

      <Hero onConsultation={scrollToContact} />
      <Services />
      <Process />
      <Portfolio isAdmin={isAdmin} />
      <ArchitectSpotlight />
      <Contact />
      <Footer />
      <ColorQuiz isOpen={isQuizOpen} onClose={() => setIsQuizOpen(false)} />
    </div>
  );
}
