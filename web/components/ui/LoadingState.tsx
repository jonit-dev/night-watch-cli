import React from 'react';

interface ILoadingStateProps {
  message?: string;
}

const LoadingState: React.FC<ILoadingStateProps> = ({ message = 'Loading...' }) => {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400">{message}</div>
    </div>
  );
};

export default LoadingState;
