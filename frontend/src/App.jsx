import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Projects from "./pages/Projects";
import Members from "./pages/Members";
import Timeline from "./pages/Timeline";
import UnderstandingTask from "./pages/Understanding_Task";
import UnderstandingQuestions from "./pages/Understanding_Questions";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route path="/project" element={<Projects />} />
        <Route path="/project/:projectId" element={<Projects />}/>
        <Route path="/project/:projectId/members" element={<Members />}/>
        <Route path="/project/:projectId/member/:memberId" element={<Members />}/>
        <Route path="/project/:projectId/timeline" element={<Timeline />}/>

        <Route path="/project/:projectId/understanding/tasks" element={<UnderstandingTask />}/>
        <Route path="/project/:projectId/member/:memberId/understanding/questions" element={<UnderstandingQuestions />}/>

        <Route path="*" element={<Navigate to="/" replace />}/>
      </Routes>
    </BrowserRouter>
  );
}
